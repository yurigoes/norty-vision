#!/usr/bin/env bash
# ==============================================================================
# cloudflare-tunnel-provision.sh
#
# Cria (ou reusa) um Cloudflare Tunnel via API e configura tudo automaticamente:
#   1) cria tunnel "named" no account
#   2) pega o token do conector (pra cloudflared --token=...)
#   3) configura ingress rules apontando hostnames -> http://yugo-caddy:80
#   4) cria/atualiza CNAMEs proxied -> <tunnel-id>.cfargotunnel.com
#
# Idempotente: roda multiplas vezes. Se o tunnel ja existe (mesmo nome),
# reutiliza; ingress e DNS sao atualizados pra refletir o estado desejado.
#
# Pre-requisitos:
#   - jq e curl
#   - Zona delegada ja existente na Cloudflare (ex: local.yugochat.com.br
#     com NS apontando da Hostinger)
#   - API Token Cloudflare com escopos:
#       * Account > Cloudflare Tunnel    : Edit
#       * Zone    > DNS                  : Edit
#       * (limitar aos recursos especificos no Token Settings)
#
# Variaveis (obrigatorias salvo defaults):
#   CF_API_TOKEN         API Token (criar em Profile > API Tokens)
#   CF_ACCOUNT_ID        Account ID (sidebar direita do dashboard)
#   CF_ZONE_ID           Zone ID da zona delegada (Overview da zona)
#   TUNNEL_BASE_DOMAIN   ex: local.yugochat.com.br
#   TUNNEL_NAME          default: yugo-local
#   TUNNEL_HOSTNAMES     default: "app api"
#                        Se WITH_SERVICES=1 -> "app api chatwoot chamados evo"
#   CADDY_INTERNAL_URL   default: http://yugo-caddy:80
#
# Output:
#   Imprime o connector token em stdout na ultima linha (capture com command sub).
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_RED=$'\033[31m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_BLUE=$'\033[34m'

# logs vao pra stderr; stdout fica RESERVADO pro token final.
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
CADDY_INTERNAL_URL="${CADDY_INTERNAL_URL:-http://yugo-caddy:80}"

if [[ "${WITH_SERVICES:-}" == "1" ]]; then
  TUNNEL_HOSTNAMES="${TUNNEL_HOSTNAMES:-@ www chatwoot chamados evo}"
else
  TUNNEL_HOSTNAMES="${TUNNEL_HOSTNAMES:-@ www}"
fi

# SKIP_DNS=1 cria/atualiza apenas o tunnel + ingress; deixa o DNS intocado
# (util quando os hostnames ja apontam pra outra origem ativa e voce vai fazer
# o cutover depois via cloudflare-tunnel-cutover.sh)
SKIP_DNS="${SKIP_DNS:-0}"

# WITH_WILDCARD=1 (default) adiciona um ingress + CNAME wildcard
# "*.<base>" -> Caddy. E isso que liga os subdominios por empresa
# (ex: zitooticas.yugochat.com.br -> vitrine da loja). O Caddy ja encaminha
# qualquer Host pro Next.js preservando o header, e o middleware do app
# reescreve <slug>.<base>/ -> /empresa/<slug>.
# Obs: a regra wildcard entra DEPOIS dos hostnames explicitos e ANTES do 404.
WITH_WILDCARD="${WITH_WILDCARD:-1}"

API="https://api.cloudflare.com/client/v4"
H_AUTH=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

# ---------------------------------------------------------------------------
# helper: cf <method> <path> [<json-body>]
# Faz a chamada, valida success=true, retorna .result no stdout.
# ---------------------------------------------------------------------------
cf() {
  local method="$1" path="$2" body="${3:-}" resp
  if [[ -n "$body" ]]; then
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}" -d "$body")
  else
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}")
  fi
  local success
  success=$(echo "$resp" | jq -r '.success')
  if [[ "$success" != "true" ]]; then
    err "Cloudflare API falhou em $method $path"
    echo "$resp" | jq . >&2
    exit 1
  fi
  echo "$resp" | jq -c '.result'
}

# ---------------------------------------------------------------------------
# 1. valida token e pega info
# ---------------------------------------------------------------------------
log "Validando API token..."
token_info=$(cf GET /user/tokens/verify)
token_status=$(echo "$token_info" | jq -r '.status')
[[ "$token_status" == "active" ]] || die "API token nao esta active (status=$token_status)"
ok "API token valido"

# ---------------------------------------------------------------------------
# 2. resolve ou cria o tunnel
# ---------------------------------------------------------------------------
log "Procurando tunnel '$TUNNEL_NAME' no account..."
tunnels=$(cf GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false")
TUNNEL_ID=$(echo "$tunnels" | jq -r '.[0].id // empty')

if [[ -z "$TUNNEL_ID" || "$TUNNEL_ID" == "null" ]]; then
  log "Tunnel nao existe. Criando..."
  # tunnel_secret pra modo "remote" (config_src=cloudflare)
  TUNNEL_SECRET=$(openssl rand -base64 32)
  payload=$(jq -n --arg name "$TUNNEL_NAME" --arg secret "$TUNNEL_SECRET" \
    '{name:$name, tunnel_secret:$secret, config_src:"cloudflare"}')
  created=$(cf POST "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" "$payload")
  TUNNEL_ID=$(echo "$created" | jq -r '.id')
  ok "Tunnel criado: $TUNNEL_ID"
else
  ok "Tunnel ja existia: $TUNNEL_ID — reutilizando"
fi

# ---------------------------------------------------------------------------
# 3. pega o connector token (formato eyJh... que cloudflared --token usa)
# ---------------------------------------------------------------------------
log "Recuperando connector token..."
TUNNEL_TOKEN_RESP=$(curl -fsS -X GET \
  "${API}/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token" \
  "${H_AUTH[@]}")
TUNNEL_TOKEN=$(echo "$TUNNEL_TOKEN_RESP" | jq -r '.result')
[[ -n "$TUNNEL_TOKEN" && "$TUNNEL_TOKEN" != "null" ]] || die "Token vazio"
ok "Connector token obtido (${#TUNNEL_TOKEN} chars)"

# helper: traduz "@" pro nome da zona (apex), demais subs concatena com base
resolve_fqdn() {
  local sub="$1"
  if [[ "$sub" == "@" ]]; then
    echo "$TUNNEL_BASE_DOMAIN"
  else
    echo "${sub}.${TUNNEL_BASE_DOMAIN}"
  fi
}

# ---------------------------------------------------------------------------
# 4. monta ingress rules e aplica
# ---------------------------------------------------------------------------
log "Aplicando ingress rules..."
hostnames_jsonl=""
for sub in $TUNNEL_HOSTNAMES; do
  fqdn=$(resolve_fqdn "$sub")
  hostnames_jsonl="${hostnames_jsonl}${fqdn}\n"
done

WILDCARD_FQDN="*.${TUNNEL_BASE_DOMAIN}"
ingress_rules=$(printf "%b" "$hostnames_jsonl" | jq -Rsc \
  --arg svc "$CADDY_INTERNAL_URL" \
  --arg wildcard "$WILDCARD_FQDN" \
  --arg with_wildcard "$WITH_WILDCARD" \
  '
  [ (split("\n") | map(select(length > 0)) | map(
      { hostname: ., service: $svc, originRequest: { noTLSVerify: true } }
    ))[]
  ]
  + (if $with_wildcard == "1"
       then [ { hostname: $wildcard, service: $svc, originRequest: { noTLSVerify: true } } ]
       else [] end)
  + [ { service: "http_status:404" } ]
')

config_payload=$(jq -nc --argjson ingress "$ingress_rules" '{ config: { ingress: $ingress } }')
cf PUT "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" "$config_payload" >/dev/null
if [[ "$WITH_WILDCARD" == "1" ]]; then
  ok "Ingress configurado: $TUNNEL_HOSTNAMES + ${WILDCARD_FQDN} + fallback 404"
else
  ok "Ingress configurado: $TUNNEL_HOSTNAMES + fallback 404"
fi

# ---------------------------------------------------------------------------
# 5. cria/atualiza DNS CNAMEs apontando pro cfargotunnel
# ---------------------------------------------------------------------------
CFARGO_TARGET="${TUNNEL_ID}.cfargotunnel.com"

if [[ "$SKIP_DNS" == "1" ]]; then
  warn "SKIP_DNS=1 — pulando criacao/atualizacao de DNS records."
  warn "Tunnel + ingress estao prontos, mas trafego ainda vai pra qualquer A"
  warn "record existente. Faca o cutover quando quiser via:"
  warn "  bash cloudflare-tunnel-cutover.sh"
else
  log "Configurando DNS CNAMEs -> $CFARGO_TARGET"
  for sub in $TUNNEL_HOSTNAMES; do
    fqdn=$(resolve_fqdn "$sub")

    # verifica se ja existe ALGUM record (A, AAAA, CNAME) pra esse nome
    any_existing=$(cf GET "/zones/${CF_ZONE_ID}/dns_records?name=${fqdn}")
    other_rec_type=$(echo "$any_existing" | jq -r '[.[] | select(.type != "CNAME")][0].type // empty')
    other_rec_content=$(echo "$any_existing" | jq -r '[.[] | select(.type != "CNAME")][0].content // empty')

    if [[ -n "$other_rec_type" ]]; then
      warn "  ${fqdn} ja tem record ${other_rec_type} -> ${other_rec_content}"
      warn "  pulando (provavel apontando pra outra origem ativa)"
      warn "  use cloudflare-tunnel-cutover.sh quando quiser migrar"
      continue
    fi

    existing=$(echo "$any_existing" | jq -c '[.[] | select(.type=="CNAME")]')
    rec_id=$(echo "$existing" | jq -r '.[0].id // empty')
    rec_content=$(echo "$existing" | jq -r '.[0].content // empty')

    if [[ -z "$rec_id" ]]; then
      log "  + criando CNAME ${fqdn}"
      body=$(jq -nc --arg name "$fqdn" --arg content "$CFARGO_TARGET" \
        '{type:"CNAME", name:$name, content:$content, ttl:1, proxied:true, comment:"yugo tunnel"}')
      cf POST "/zones/${CF_ZONE_ID}/dns_records" "$body" >/dev/null
      ok "  CNAME ${fqdn} criado"
    elif [[ "$rec_content" != "$CFARGO_TARGET" ]]; then
      log "  ~ atualizando CNAME ${fqdn} (estava ${rec_content})"
      body=$(jq -nc --arg name "$fqdn" --arg content "$CFARGO_TARGET" \
        '{type:"CNAME", name:$name, content:$content, ttl:1, proxied:true, comment:"yugo tunnel"}')
      cf PUT "/zones/${CF_ZONE_ID}/dns_records/${rec_id}" "$body" >/dev/null
      ok "  CNAME ${fqdn} atualizado"
    else
      ok "  CNAME ${fqdn} ja correto"
    fi
  done

  # wildcard CNAME *.<base> -> tunnel (liga os subdominios por empresa)
  if [[ "$WITH_WILDCARD" == "1" ]]; then
    wfqdn="*.${TUNNEL_BASE_DOMAIN}"
    # filtra client-side pra evitar problema de encoding do '*' na query
    w_existing=$(cf GET "/zones/${CF_ZONE_ID}/dns_records?type=CNAME&per_page=200" \
      | jq -c --arg n "$wfqdn" '[.[] | select(.name==$n)]')
    w_id=$(echo "$w_existing" | jq -r '.[0].id // empty')
    w_content=$(echo "$w_existing" | jq -r '.[0].content // empty')
    w_body=$(jq -nc --arg name "$wfqdn" --arg content "$CFARGO_TARGET" \
      '{type:"CNAME", name:$name, content:$content, ttl:1, proxied:true, comment:"yugo tunnel wildcard (subdominios por empresa)"}')
    if [[ -z "$w_id" ]]; then
      log "  + criando wildcard CNAME ${wfqdn}"
      cf POST "/zones/${CF_ZONE_ID}/dns_records" "$w_body" >/dev/null
      ok "  wildcard CNAME ${wfqdn} criado"
    elif [[ "$w_content" != "$CFARGO_TARGET" ]]; then
      log "  ~ atualizando wildcard CNAME ${wfqdn} (estava ${w_content})"
      cf PUT "/zones/${CF_ZONE_ID}/dns_records/${w_id}" "$w_body" >/dev/null
      ok "  wildcard CNAME ${wfqdn} atualizado"
    else
      ok "  wildcard CNAME ${wfqdn} ja correto"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. resultado final: token vai pro stdout (linha unica) pra ser capturado
# ---------------------------------------------------------------------------
log "Pronto. Tunnel ID: $TUNNEL_ID"
log "Hostnames publicos:"
for sub in $TUNNEL_HOSTNAMES; do
  log "  https://${sub}.${TUNNEL_BASE_DOMAIN}"
done
[[ "$WITH_WILDCARD" == "1" ]] && log "  https://*.${TUNNEL_BASE_DOMAIN}  (subdominios por empresa -> vitrine)"

echo "$TUNNEL_TOKEN"
