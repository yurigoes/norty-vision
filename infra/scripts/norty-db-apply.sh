#!/usr/bin/env bash
# ==============================================================================
# norty-db-apply.sh — cria o banco norty_vision no container nv-postgres e
# aplica TODO o schema (packages/db/sql). Espelho do db-apply.sh, alvo = stack
# autocontido do Norty Vision. Idempotente. Roda na VPS.
#
# Gera/grava as senhas dos roles yugo_app/yugo_migrator (nomes usados pelos SQLs)
# de volta no .env.norty.
# ==============================================================================
set -euo pipefail

readonly C_RESET=$'\033[0m'; readonly C_GREEN=$'\033[32m'
readonly C_RED=$'\033[31m'; readonly C_BLUE=$'\033[34m'
log()  { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_DIR="$REPO_DIR/packages/db/sql"
ENV_FILE="$REPO_DIR/infra/docker/.env.norty"
CONTAINER=nv-postgres

[[ -d "$SQL_DIR" ]] || die "Diretório SQL não encontrado: $SQL_DIR"
[[ -f "$ENV_FILE" ]] || die "Falta $ENV_FILE. Rode norty-generate-secrets.sh primeiro."

get_env() { grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
POSTGRES_DB=$(get_env POSTGRES_DB)
POSTGRES_USER=$(get_env POSTGRES_USER)
POSTGRES_PASSWORD=$(get_env POSTGRES_PASSWORD)
[[ -n "$POSTGRES_DB" && -n "$POSTGRES_USER" && -n "$POSTGRES_PASSWORD" ]] \
  || die "POSTGRES_DB/USER/PASSWORD ausentes em $ENV_FILE"

ensure_role_password() {
  local key="$1"
  if [[ -z "$(get_env "$key" 2>/dev/null || true)" ]]; then
    local new; new=$(openssl rand -base64 48 | tr -d '\n=/+' | head -c 48)
    umask 077; echo "${key}=${new}" >> "$ENV_FILE"
    log "Gerado $key e gravado em $ENV_FILE"
  fi
}
ensure_role_password YUGO_APP_PASSWORD
ensure_role_password YUGO_MIGRATOR_PASSWORD
YUGO_APP_PASSWORD=$(get_env YUGO_APP_PASSWORD)
YUGO_MIGRATOR_PASSWORD=$(get_env YUGO_MIGRATOR_PASSWORD)

docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" \
  || die "Container ${CONTAINER} não está rodando. Suba nv-postgres primeiro."

SU()  { docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
MIG() { docker exec -i -e PGPASSWORD="$YUGO_MIGRATOR_PASSWORD" "$CONTAINER" psql -U yugo_migrator -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"; }

log "Criando DB $POSTGRES_DB (se não existe)"
if ! SU postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1; then
  SU postgres -c "CREATE DATABASE $POSTGRES_DB"
fi

log "000_roles.sql + 001_extensions.sql (super-user) em $POSTGRES_DB"
SU "$POSTGRES_DB" -v "yugo_app_password=$YUGO_APP_PASSWORD" -v "yugo_migrator_password=$YUGO_MIGRATOR_PASSWORD" < "$SQL_DIR/000_roles.sql" >/dev/null
SU "$POSTGRES_DB" -c "GRANT CONNECT, CREATE ON DATABASE $POSTGRES_DB TO yugo_app, yugo_migrator" >/dev/null
SU "$POSTGRES_DB" < "$SQL_DIR/001_extensions.sql" >/dev/null

log "migrations"
for f in $(ls "$SQL_DIR"/*.sql | sort); do
  b=$(basename "$f")
  case "$b" in 000_roles.sql|001_extensions.sql) continue;; esac
  case "$b" in
    *grants*|*roles*) SU "$POSTGRES_DB" < "$f" >/dev/null ;;
    *)                MIG < "$f" >/dev/null ;;
  esac
  ok "$b"
done

log "tabelas em public:"
MIG -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname='public'"
ok "Schema aplicado em $POSTGRES_DB."
