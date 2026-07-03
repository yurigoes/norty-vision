#!/usr/bin/env bash
# ==============================================================================
# sync-gateways.sh — puxa a lista de gateways SIP do yugo (multiempresa) e
# reescreve os arquivos sip_profiles/external/*.xml, depois manda o FreeSWITCH
# reler a config. Instalado pelo setup.sh como cron a cada 30s.
# Idempotente; silencioso em caso de erro de rede (FS continua com a config velha).
# ==============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/.env" ]] || { echo "sem .env" >&2; exit 0; }
set -a; . "$HERE/.env"; set +a

API_URL="${API_URL:-}"
SECRET="${VOIP_FS_SECRET:-}"
DIR="$HERE/generated/freeswitch-conf/sip_profiles/external"
[[ -n "$API_URL" && -n "$SECRET" ]] || exit 0
command -v jq >/dev/null || exit 0

mkdir -p "$DIR"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if ! curl -fsS --max-time 6 "${API_URL%/}/api/voip/fs/gateways?secret=${SECRET}" -o "$TMP"; then
  exit 0
fi

# nomes ativos vindos da API
mapfile -t ACTIVE < <(jq -r '.items[]?.name // empty' "$TMP" | sort -u)

# escreve cada xml em DIR/<name>.xml
jq -c '.items[]?' "$TMP" | while IFS= read -r row; do
  name=$(jq -r '.name' <<<"$row")
  xml=$(jq -r '.xml' <<<"$row")
  [[ -n "$name" && -n "$xml" ]] || continue
  printf '%s\n' "$xml" > "$DIR/${name}.xml"
done

# remove arquivos antigos que não estão mais ativos (preserva yugo-trunk legado)
shopt -s nullglob
for f in "$DIR"/*.xml; do
  base=$(basename "$f" .xml)
  [[ "$base" == "yugo-trunk" ]] && continue
  found=0
  for n in "${ACTIVE[@]:-}"; do [[ "$n" == "$base" ]] && found=1; done
  (( found == 0 )) && rm -f "$f"
done

# pede pro FS recarregar perfil externo + xml (idempotente; ignora se container off)
docker exec yugo-fs fs_cli -x 'reloadxml' >/dev/null 2>&1 || true
docker exec yugo-fs fs_cli -x 'sofia profile external rescan reloadxml' >/dev/null 2>&1 || true
