#!/usr/bin/env bash
# ==============================================================================
# cloudflare-tunnel-wildcard.sh
#
# Adiciona (de forma NAO-destrutiva) o wildcard "*.<base>" ao tunnel ja
# existente em producao:
#   1) le a config de ingress atual do tunnel
#   2) insere a regra wildcard -> Caddy logo ANTES do catch-all (404), se faltar
#   3) faz PUT preservando todas as regras existentes (chatwoot/chamados/evo/...)
#   4) cria/atualiza o CNAME proxied "*.<base>" -> <tunnel-id>.cfargotunnel.com
#
# É isso que liga os subdominios por empresa:
#   zitooticas.yugochat.com.br -> Caddy -> Next.js (middleware reescreve pra
#   /empresa/zitooticas, a vitrine da loja com o branding da empresa).
#
# Use este script quando o tunnel JÁ está provisionado e voce so quer ligar o
# wildcard sem mexer no resto do ingress. Idempotente.
#
# Variaveis (obrigatorias):
#   CF_API_TOKEN         API Token (Account>Tunnel:Edit, Zone>DNS:Edit)
#   CF_ACCOUNT_ID        Account ID
#   CF_ZONE_ID           Zone ID
#   TUNNEL_BASE_DOMAIN   ex: yugochat.com.br
#   TUNNEL_NAME          default: yugo-local
#   CADDY_INTERNAL_URL   default: http://yugo-caddy:80
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'; readonly C_RED=$'\033[31m'
readonly C_GREEN=$'\033[32m'; readonly C_YELLOW=$'\033[33m'; readonly C_BLUE=$'\033[34m'
log()  { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*" >&2; }
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

API="https://api.cloudflare.com/client/v4"
H_AUTH=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

cf() {
  local method="$1" path="$2" body="${3:-}" resp
  if [[ -n "$body" ]]; then
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}" -d "$body")
  else
    resp=$(curl -fsS -X "$method" "${API}${path}" "${H_AUTH[@]}")
  fi
  [[ "$(echo "$resp" | jq -r '.success')" == "true" ]] || { err "CF API falhou em $method $path"; echo "$resp" | jq . >&2; exit 1; }
  echo "$resp" | jq -c '.result'
}

# 1. resolve tunnel
log "Procurando tunnel '$TUNNEL_NAME'..."
TUNNEL_ID=$(cf GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false" | jq -r '.[0].id // empty')
[[ -n "$TUNNEL_ID" ]] || die "Tunnel '$TUNNEL_NAME' nao encontrado"
ok "Tunnel: $TUNNEL_ID"

WILDCARD_FQDN="*.${TUNNEL_BASE_DOMAIN}"
CFARGO_TARGET="${TUNNEL_ID}.cfargotunnel.com"

# 2. le ingress atual
log "Lendo ingress atual..."
current=$(cf GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations")
ingress=$(echo "$current" | jq -c '.config.ingress // []')
[[ "$ingress" != "null" && -n "$ingress" ]] || ingress='[{"service":"http_status:404"}]'

already=$(echo "$ingress" | jq --arg w "$WILDCARD_FQDN" '[.[] | select(.hostname==$w)] | length')
if [[ "$already" -gt 0 ]]; then
  ok "Wildcard ${WILDCARD_FQDN} ja presente no ingress"
else
  # insere a regra wildcard imediatamente ANTES do primeiro catch-all (regra sem hostname)
  new_ingress=$(echo "$ingress" | jq -c \
    --arg w "$WILDCARD_FQDN" --arg svc "$CADDY_INTERNAL_URL" '
    ([.[] | select(has("hostname"))]) as $hosts
    | ([.[] | select(has("hostname") | not)]) as $catch
    | $hosts + [ { hostname: $w, service: $svc, originRequest: { noTLSVerify: true } } ] + $catch
  ')
  cf PUT "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
    "$(jq -nc --argjson ingress "$new_ingress" '{config:{ingress:$ingress}}')" >/dev/null
  ok "Wildcard ${WILDCARD_FQDN} inserido no ingress (regras existentes preservadas)"
fi

# 3. DNS wildcard CNAME (proxied) -> tunnel
log "Configurando wildcard CNAME ${WILDCARD_FQDN} -> ${CFARGO_TARGET}"
w_existing=$(cf GET "/zones/${CF_ZONE_ID}/dns_records?type=CNAME&per_page=200" \
  | jq -c --arg n "$WILDCARD_FQDN" '[.[] | select(.name==$n)]')
w_id=$(echo "$w_existing" | jq -r '.[0].id // empty')
w_content=$(echo "$w_existing" | jq -r '.[0].content // empty')
w_body=$(jq -nc --arg name "$WILDCARD_FQDN" --arg content "$CFARGO_TARGET" \
  '{type:"CNAME", name:$name, content:$content, ttl:1, proxied:true, comment:"yugo tunnel wildcard (subdominios por empresa)"}')
if [[ -z "$w_id" ]]; then
  cf POST "/zones/${CF_ZONE_ID}/dns_records" "$w_body" >/dev/null
  ok "wildcard CNAME criado"
elif [[ "$w_content" != "$CFARGO_TARGET" ]]; then
  cf PUT "/zones/${CF_ZONE_ID}/dns_records/${w_id}" "$w_body" >/dev/null
  ok "wildcard CNAME atualizado (estava ${w_content})"
else
  ok "wildcard CNAME ja correto"
fi

ok "Pronto. Subdominios por empresa ativos: https://<slug>.${TUNNEL_BASE_DOMAIN}"
