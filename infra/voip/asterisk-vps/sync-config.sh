#!/usr/bin/env bash
# ==============================================================================
# sync-config.sh — puxa da API do yugo a lista atualizada de ramais + trunks,
# regenera pjsip_dynamic.conf, e manda o Asterisk recarregar res_pjsip.
# Cron a cada 30s (instalado pelo setup.sh).
# ==============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/.env" ]] || exit 0
set -a; . "$HERE/.env"; set +a

API_URL="${API_URL:-}"
SECRET="${VOIP_FS_SECRET:-}"
DYN="$HERE/generated/asterisk-etc/pjsip_dynamic.conf"
[[ -n "$API_URL" && -n "$SECRET" ]] || exit 0
command -v jq >/dev/null || exit 0
command -v curl >/dev/null || exit 0
[[ -d "$HERE/generated/asterisk-etc" ]] || exit 0

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if ! curl -fsS --max-time 8 "${API_URL%/}/api/voip/asterisk/config?secret=${SECRET}" -o "$TMP"; then
  exit 0   # API offline: mantém config anterior, sai silencioso
fi

# A API devolve JSON: { ramais: [{ ext, secret, displayName }], trunks: [...] }
{
  echo "; AUTOGERADO por sync-config.sh — NÃO EDITE À MÃO"
  echo "; ramais (endpoints + auth + aor)"
  jq -r '.ramais[]? |
    "\n[\(.ext)]\ntype=aor\nmax_contacts=1\nremove_existing=yes\nqualify_frequency=60\n",
    "[\(.ext)]\ntype=auth\nauth_type=userpass\nusername=\(.ext)\npassword=\(.secret)\n",
    "[\(.ext)]\ntype=endpoint\ntransport=transport-ws\ncontext=internal\ndisallow=all\nallow=opus\nallow=ulaw\nauth=\(.ext)\naors=\(.ext)\ndirect_media=no\nwebrtc=yes\nuse_avpf=yes\nmedia_encryption=dtls\ndtls_auto_generate_cert=yes\nrewrite_contact=yes\nforce_rport=yes\nrtp_symmetric=yes\nice_support=yes\ncallerid=\(.displayName // .ext) <\(.ext)>\n"' "$TMP"

  echo "; trunks (SIP outbound + registration)"
  jq -r '.trunks[]? |
    "[trunk-aor-\(.name)]\ntype=aor\ncontact=sip:\(.host)\nqualify_frequency=60\n",
    "[trunk-auth-\(.name)]\ntype=auth\nauth_type=userpass\nusername=\(.user)\npassword=\(.pass)\n",
    "[trunk-\(.name)]\ntype=endpoint\ntransport=transport-udp\ncontext=from-trunk\ndisallow=all\nallow=ulaw\nallow=alaw\nauth=trunk-auth-\(.name)\noutbound_auth=trunk-auth-\(.name)\naors=trunk-aor-\(.name)\nfrom_user=\(.user)\nfrom_domain=\(.host)\nrtp_symmetric=yes\nforce_rport=yes\nrewrite_contact=yes\nice_support=yes\nlanguage=pt_BR\n",
    "[trunk-id-\(.name)]\ntype=identify\nendpoint=trunk-\(.name)\nmatch=\(.host)\n",
    "[trunk-reg-\(.name)]\ntype=registration\ntransport=transport-udp\noutbound_auth=trunk-auth-\(.name)\nserver_uri=sip:\(.host)\nclient_uri=sip:\(.user)@\(.host)\ncontact_user=\(.user)\nretry_interval=60\n"' "$TMP"

  # Alias [trunk] (endpoint) pra o dialplan: Dial(PJSIP/<num>@trunk).
  # Aponta pras MESMAS auth/aor + from_user/from_domain do 1º trunk encontrado.
  TRUNK1_NAME=$(jq -r '.trunks[0]?.name // empty' "$TMP")
  TRUNK1_USER=$(jq -r '.trunks[0]?.user // empty' "$TMP")
  TRUNK1_HOST=$(jq -r '.trunks[0]?.host // empty' "$TMP")
  if [[ -n "$TRUNK1_NAME" ]]; then
    cat <<EOA

[trunk]
type=endpoint
transport=transport-udp
context=from-trunk
disallow=all
allow=ulaw
allow=alaw
auth=trunk-auth-${TRUNK1_NAME}
outbound_auth=trunk-auth-${TRUNK1_NAME}
aors=trunk-aor-${TRUNK1_NAME}
from_user=${TRUNK1_USER}
from_domain=${TRUNK1_HOST}
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
ice_support=yes
language=pt_BR
EOA
  fi
} > "${DYN}.new"

# Só substitui se houve mudança (evita reloads desnecessários)
if ! cmp -s "${DYN}.new" "$DYN" 2>/dev/null; then
  mv "${DYN}.new" "$DYN"
  docker exec yugo-asterisk asterisk -rx 'pjsip reload' >/dev/null 2>&1 || true
  docker exec yugo-asterisk asterisk -rx 'module reload res_pjsip.so' >/dev/null 2>&1 || true
else
  rm -f "${DYN}.new"
fi
