#!/usr/bin/env bash
# ==============================================================================
# cloudflare-tunnel-cutover.sh
#
# Cutover atomico: para cada hostname listado, REMOVE o A/AAAA existente
# (apontando pra origem antiga) e CRIA um CNAME proxied apontando pro tunnel.
#
# Use depois de:
#   1) cloudflare-tunnel-provision.sh com SKIP_DNS=1 (tunnel ja criado e
#      ingress configurado)
#   2) ter migrado dados do servidor antigo pro novo
#   3) ter validado que o tunnel responde corretamente
#
# Pre-requisitos:
#   - jq, curl
#   - tunnel ja existente (mesmo TUNNEL_NAME)
#   - cloudflared rodando na nova VPS e conectado HEALTHY
#
# Variaveis:
#   CF_API_TOKEN         (obrigatorio)
#   CF_ACCOUNT_ID        (obrigatorio)
#   CF_ZONE_ID           (obrigatorio)
#   TUNNEL_BASE_DOMAIN   (obrigatorio)
#   TUNNEL_NAME          default: yugo-local
#   TUNNEL_HOSTNAMES     subs separados por espaco. "@" = apex.
#                        default: "@ www chatwoot chamados evo"
#   DRY_RUN=1            so mostra o que faria, sem alterar
#
# Uso:
#   DRY_RUN=1 \
#   CF_API_TOKEN=... CF_ACCOUNT_ID=... CF_ZONE_ID=... \
#   TUNNEL_BASE_DOMAIN=yugochat.com.br \
#   bash cloudflare-tunnel-cutover.sh
#
# Depois sem DRY_RUN pra aplicar de verdade.
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_RED=$'\033[31m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_BLUE=$'\033[34m'
readonly C_BOLD=$'\033[1m'

log()  { printf '%s[%s]%s %s\n' "$C_BLUE"  "$(date +%H:%M:%S)" "$C_RESET" "$*" >&2; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

command -v curl >/dev/null || die "curl ausente"
command -v jq   >/dev/null || die "jq ausente (apt install jq)"

: "${CF_API_TOKEN:?CF_API_TOKEN obrigatorio}"
: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID obrigatorio}"
: "${CF_ZONE_ID:?CF_ZONE_ID obrigatorio}"
: "${TUNNEL_BASE_DOMAIN:?TUNNEL_BASE_DOMAIN obrigatorio}"

TUNNEL_NAME="${TUNNEL_NAME:-yugo-local}"
TUNNEL_HOSTNAMES="${TUNNEL_HOSTNAMES:-@ www chatwoot chamados evo}"
DRY_RUN="${DRY_RUN:-0}"

API="https://api.cloudflare.com/client/v4"
H_AUTH=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

cf() {
  local method="$1" path="$2" body="${3:-}" resp
  if [[ -n "$body" ]]; then
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}" -d "$body")
  else
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}")
  fi
  local success=$(echo "$resp" | jq -r '.success')
  if [[ "$success" != "true" ]]; then
    err "Cloudflare API falhou em $method $path"
    echo "$resp" | jq . >&2
    exit 1
  fi
  echo "$resp" | jq -c '.result'
}

resolve_fqdn() {
  local sub="$1"
  if [[ "$sub" == "@" ]]; then
    echo "$TUNNEL_BASE_DOMAIN"
  else
    echo "${sub}.${TUNNEL_BASE_DOMAIN}"
  fi
}

# --- 1. acha o tunnel ---
log "Procurando tunnel '$TUNNEL_NAME'..."
tunnels=$(cf GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false")
TUNNEL_ID=$(echo "$tunnels" | jq -r '.[0].id // empty')
[[ -n "$TUNNEL_ID" ]] || die "Tunnel '$TUNNEL_NAME' nao existe — rode provision.sh primeiro"
ok "Tunnel: $TUNNEL_ID"

# --- 2. verifica que tunnel esta healthy (tem conexao ativa) ---
status=$(cf GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}")
healthy=$(echo "$status" | jq -r '.status')
if [[ "$healthy" != "healthy" ]]; then
  warn "Tunnel status: $healthy (esperava 'healthy')"
  warn "Confirme que cloudflared esta rodando na VPS local antes do cutover"
  if [[ "$DRY_RUN" != "1" ]]; then
    printf '%s? Continuar mesmo assim? [y/N]%s ' "$C_BOLD" "$C_RESET" >&2
    read -r ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Abortado pelo usuario"
  fi
else
  ok "Tunnel HEALTHY — seguro pra cutover"
fi

CFARGO_TARGET="${TUNNEL_ID}.cfargotunnel.com"

# --- 3. para cada hostname: deleta A/AAAA + cria CNAME proxied ---
[[ "$DRY_RUN" == "1" ]] && warn "DRY_RUN=1 — nenhuma alteracao sera feita"

echo >&2
for sub in $TUNNEL_HOSTNAMES; do
  fqdn=$(resolve_fqdn "$sub")
  log "==> $fqdn"

  records=$(cf GET "/zones/${CF_ZONE_ID}/dns_records?name=${fqdn}")
  count=$(echo "$records" | jq 'length')

  if [[ "$count" -eq 0 ]]; then
    warn "  sem records — vou apenas criar o CNAME"
  fi

  # remove tudo que nao seja MX/TXT (preserva email/SPF)
  echo "$records" | jq -c '.[] | select(.type=="A" or .type=="AAAA" or .type=="CNAME")' | while read -r rec; do
    rid=$(echo "$rec" | jq -r '.id')
    rtype=$(echo "$rec" | jq -r '.type')
    rcontent=$(echo "$rec" | jq -r '.content')

    if [[ "$rtype" == "CNAME" && "$rcontent" == "$CFARGO_TARGET" ]]; then
      ok "  CNAME ja aponta pro tunnel — preservando"
      continue
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
      warn "  [dry] DELETE ${rtype} ${fqdn} -> ${rcontent} (id=${rid})"
    else
      cf DELETE "/zones/${CF_ZONE_ID}/dns_records/${rid}" >/dev/null
      ok "  deletado ${rtype} ${fqdn} (era ${rcontent})"
    fi
  done

  # se nao existir CNAME apontando pro tunnel, criar
  has_cname_to_tunnel=$(echo "$records" | jq --arg t "$CFARGO_TARGET" \
    '[.[] | select(.type=="CNAME" and .content==$t)] | length')
  if [[ "$has_cname_to_tunnel" == "0" ]]; then
    if [[ "$DRY_RUN" == "1" ]]; then
      warn "  [dry] CREATE CNAME ${fqdn} -> ${CFARGO_TARGET} (proxied)"
    else
      body=$(jq -nc --arg name "$fqdn" --arg content "$CFARGO_TARGET" \
        '{type:"CNAME", name:$name, content:$content, ttl:1, proxied:true, comment:"yugo tunnel (cutover)"}')
      cf POST "/zones/${CF_ZONE_ID}/dns_records" "$body" >/dev/null
      ok "  CNAME ${fqdn} -> tunnel"
    fi
  fi
done

echo >&2
if [[ "$DRY_RUN" == "1" ]]; then
  warn "DRY_RUN concluido — nada alterado. Rode sem DRY_RUN pra aplicar."
else
  ok "Cutover concluido. Propagacao: 1-5 min (CF cache pode demorar mais)."
  ok "Valide com:"
  for sub in $TUNNEL_HOSTNAMES; do
    fqdn=$(resolve_fqdn "$sub")
    ok "  curl -sI https://${fqdn}/health 2>&1 | head -3"
  done
fi
