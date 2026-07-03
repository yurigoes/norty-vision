#!/usr/bin/env bash
# ==============================================================================
# db-apply.sh - aplica TODOS os SQLs do packages/db/sql no Postgres do compose.
#
# Idempotente: pode rodar varias vezes sem efeito colateral.
# Os SQLs sao escritos pra usar IF NOT EXISTS / DROP+CREATE.
#
# Uso:
#   bash infra/scripts/db-apply.sh
#
# Variaveis lidas de infra/docker/.env.production:
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD (super-user do container)
#
# Senhas dos roles yugo_app/yugo_migrator sao GERADAS aqui e gravadas
# de volta no .env.production (chaves YUGO_APP_PASSWORD / YUGO_MIGRATOR_PASSWORD).
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_RED=$'\033[31m'
readonly C_BLUE=$'\033[34m'

log()  { printf '%s[%s]%s %s\n' "$C_BLUE"  "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_DIR="$REPO_DIR/packages/db/sql"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"
COMPOSE_FILE="$REPO_DIR/infra/docker/docker-compose.prod.yml"

[[ -d "$SQL_DIR" ]] || die "Diretorio SQL nao encontrado: $SQL_DIR"
[[ -f "$ENV_FILE" ]] || die "Falta $ENV_FILE. Rode generate-secrets.sh primeiro."

# carrega env de forma segura (so as variaveis que precisamos)
get_env() { grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

POSTGRES_DB=$(get_env POSTGRES_DB)
POSTGRES_USER=$(get_env POSTGRES_USER)
POSTGRES_PASSWORD=$(get_env POSTGRES_PASSWORD)

[[ -n "$POSTGRES_DB" && -n "$POSTGRES_USER" && -n "$POSTGRES_PASSWORD" ]] \
  || die "POSTGRES_DB/USER/PASSWORD ausentes em $ENV_FILE"

# garante senhas dos roles yugo_app e yugo_migrator (gera se ausente)
ensure_role_password() {
  local key="$1"
  local current
  current=$(get_env "$key" 2>/dev/null || true)
  if [[ -z "$current" ]]; then
    local new
    new=$(openssl rand -base64 48 | tr -d '\n=/+' | head -c 48)
    # append no .env (modo 600)
    umask 077
    echo "${key}=${new}" >> "$ENV_FILE"
    log "Gerado $key e gravado em $ENV_FILE"
  fi
}

ensure_role_password YUGO_APP_PASSWORD
ensure_role_password YUGO_MIGRATOR_PASSWORD

YUGO_APP_PASSWORD=$(get_env YUGO_APP_PASSWORD)
YUGO_MIGRATOR_PASSWORD=$(get_env YUGO_MIGRATOR_PASSWORD)

# verifica container postgres up
if ! docker ps --format '{{.Names}}' | grep -q '^yugo-postgres$'; then
  die "Container yugo-postgres nao esta rodando. Rode deploy-prod.sh."
fi

# helper pra rodar psql no container
psql_run() {
  local user="$1"; shift
  local pw="$1"; shift
  docker exec -i \
    -e PGPASSWORD="$pw" \
    yugo-postgres psql -U "$user" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

# helper pra rodar arquivo SQL via stdin
psql_run_file() {
  local user="$1"; shift
  local pw="$1"; shift
  local file="$1"; shift
  docker exec -i \
    -e PGPASSWORD="$pw" \
    yugo-postgres psql -U "$user" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@" < "$file"
}

# --- 1. 000_roles.sql - cria roles yugo_app e yugo_migrator -----------------
log "Aplicando 000_roles.sql como super-user $POSTGRES_USER..."
psql_run "$POSTGRES_USER" "$POSTGRES_PASSWORD" \
  -v "yugo_app_password=$YUGO_APP_PASSWORD" \
  -v "yugo_migrator_password=$YUGO_MIGRATOR_PASSWORD" \
  < "$SQL_DIR/000_roles.sql"
ok "Roles do Postgres prontos."

# --- 2. 001_extensions.sql como super-user (CREATE EXTENSION exige) ---------
log "Aplicando 001_extensions.sql como super-user $POSTGRES_USER..."
psql_run_file "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$SQL_DIR/001_extensions.sql"
ok "Extensions e schema 'app' criados."

# --- 3. Demais arquivos como yugo_migrator (BYPASSRLS) ----------------------
#    GRANTs (019_*) precisam super-user.
for f in $(ls "$SQL_DIR"/*.sql | sort); do
  base=$(basename "$f")
  case "$base" in
    000_roles.sql|001_extensions.sql) continue ;;
  esac
  log "Aplicando $base..."
  # GRANTs sao executados como super-user (postgres) pra ter permissao
  case "$base" in
    *grants*|*roles*)
      if psql_run_file "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$f"; then
        ok "$base (super-user)"
      else
        err "Falhou em $base"
        exit 1
      fi
      ;;
    *)
      if psql_run_file yugo_migrator "$YUGO_MIGRATOR_PASSWORD" "$f"; then
        ok "$base"
      else
        err "Falhou em $base"
        exit 1
      fi
      ;;
  esac
done

# --- 3. Resumo ---------------------------------------------------------------
log "Resumo do schema:"
psql_run yugo_migrator "$YUGO_MIGRATOR_PASSWORD" -c "
SELECT n.nspname AS schema, count(*) AS tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','app')
 GROUP BY n.nspname ORDER BY n.nspname;
"

psql_run yugo_migrator "$YUGO_MIGRATOR_PASSWORD" -c "
SELECT
  (SELECT count(*) FROM intent_keywords) AS intent_keywords,
  (SELECT count(*) FROM roles) AS roles,
  (SELECT count(*) FROM help_articles) AS help_articles,
  (SELECT count(*) FROM system_guide_sections) AS guide_sections,
  (SELECT count(*) FROM tech_spec_documents) AS tech_specs;
"

ok "Database aplicada com sucesso."
ok "Roles e suas senhas estao em $ENV_FILE."
