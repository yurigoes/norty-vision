#!/usr/bin/env bash
# ==============================================================================
# cl-db-apply.sh — cria o banco PRÓPRIO da Central de Leads (centraldeleads) no
# mesmo container yugo-postgres e aplica TODO o schema (packages/db/sql).
#
# Espelho do db-apply.sh, mas alvo = database `centraldeleads` (login/dados
# isolados do yugo). Idempotente. Roda na VPS.
# ==============================================================================
set -euo pipefail
ENV_FILE=/opt/yugo-platform/infra/docker/.env.production
SQL_DIR=/opt/yugo-platform/packages/db/sql
TARGET_DB=centraldeleads
get_env(){ grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
PGUSER=$(get_env POSTGRES_USER); PGPW=$(get_env POSTGRES_PASSWORD)
APPPW=$(get_env YUGO_APP_PASSWORD); MIGPW=$(get_env YUGO_MIGRATOR_PASSWORD)
SU(){ docker exec -i -e PGPASSWORD="$PGPW" yugo-postgres psql -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
MIG(){ docker exec -i -e PGPASSWORD="$MIGPW" yugo-postgres psql -U yugo_migrator -d "$TARGET_DB" -v ON_ERROR_STOP=1 "$@"; }
echo ">> criando DB $TARGET_DB (se nao existe)"
if ! SU postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET_DB'" | grep -q 1; then
  SU postgres -c "CREATE DATABASE $TARGET_DB"
fi
SU postgres -c "GRANT CONNECT, CREATE ON DATABASE $TARGET_DB TO yugo_app, yugo_migrator"
echo ">> 000_roles + 001_extensions (superuser) em $TARGET_DB"
SU "$TARGET_DB" -v "yugo_app_password=$APPPW" -v "yugo_migrator_password=$MIGPW" < "$SQL_DIR/000_roles.sql" >/dev/null
SU "$TARGET_DB" < "$SQL_DIR/001_extensions.sql" >/dev/null
echo ">> migrations"
for f in $(ls "$SQL_DIR"/*.sql | sort); do
  b=$(basename "$f")
  case "$b" in 000_roles.sql|001_extensions.sql) continue;; esac
  case "$b" in *grants*|*roles*) SU "$TARGET_DB" < "$f" >/dev/null ;; *) MIG < "$f" >/dev/null ;; esac
done
echo ">> OK. tabelas em public:"
MIG -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname='public'"
