#!/usr/bin/env bash
# ==============================================================================
# bootstrap-services.sh - prepara Postgres com DBs/users pra Chatwoot e
# Evolution; gera senhas e adiciona em .env.production.
# Cria chatwoot.env a partir do .example.
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_GREEN=$'\033[32m'
readonly C_BLUE=$'\033[34m'
log() { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()  { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"
CHATWOOT_ENV="$REPO_DIR/infra/docker/chatwoot.env"

[[ -f "$ENV_FILE" ]] || { echo "Falta $ENV_FILE"; exit 1; }

# helpers
get_env() { grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
gen_pwd()  { openssl rand -base64 48 | tr -d '\n=/+' | head -c 48; }

ensure_env() {
  local key="$1" gen
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    gen=$(gen_pwd)
    umask 077
    echo "${key}=${gen}" >> "$ENV_FILE"
    log "Gerado $key"
  fi
}

ensure_env CHATWOOT_DB_PASSWORD
ensure_env EVOLUTION_DB_PASSWORD
ensure_env GLPI_DB_PASSWORD
ensure_env GLPI_DB_ROOT_PASSWORD
ensure_env EVOLUTION_API_KEY

POSTGRES_DB=$(get_env POSTGRES_DB)
POSTGRES_USER=$(get_env POSTGRES_USER)
POSTGRES_PASSWORD=$(get_env POSTGRES_PASSWORD)
CHATWOOT_DB_PASSWORD=$(get_env CHATWOOT_DB_PASSWORD)
EVOLUTION_DB_PASSWORD=$(get_env EVOLUTION_DB_PASSWORD)

if ! docker ps --format '{{.Names}}' | grep -q '^yugo-postgres$'; then
  echo "yugo-postgres nao esta rodando"; exit 1
fi

log "Criando DBs e roles no Postgres pra Chatwoot e Evolution..."

docker exec -i \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  yugo-postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatwoot') THEN
    CREATE ROLE chatwoot LOGIN PASSWORD '$CHATWOOT_DB_PASSWORD' CREATEDB;
  ELSE
    ALTER ROLE chatwoot WITH PASSWORD '$CHATWOOT_DB_PASSWORD';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evolution') THEN
    CREATE ROLE evolution LOGIN PASSWORD '$EVOLUTION_DB_PASSWORD';
  ELSE
    ALTER ROLE evolution WITH PASSWORD '$EVOLUTION_DB_PASSWORD';
  END IF;
END
\$\$;
SQL

# Criar databases (se nao existir). CREATE DATABASE nao aceita IF NOT EXISTS
# nem pode estar em transacao; checamos via shell e criamos so se faltar.
create_db_if_missing() {
  local db="$1" owner="$2"
  local exists
  exists=$(docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" yugo-postgres \
    psql -U "$POSTGRES_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${db}'")
  if [[ "$exists" == "1" ]]; then
    log "DB '${db}' ja existe"
  else
    docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" yugo-postgres \
      psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c \
      "CREATE DATABASE \"${db}\" OWNER \"${owner}\""
    ok "DB '${db}' criado"
  fi
}

create_db_if_missing chatwoot chatwoot
create_db_if_missing evolution evolution

# pg_stat_statements precisa ser criado pelo superuser (POSTGRES_USER) no DB
# do chatwoot — chatwoot tenta usar e nao tem permissao de CREATE EXTENSION.
log "Garantindo pg_stat_statements no DB chatwoot..."
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" yugo-postgres \
  psql -U "$POSTGRES_USER" -d chatwoot -v ON_ERROR_STOP=1 -c \
  "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" 2>/dev/null \
  || log "pg_stat_statements indisponivel (provavel imagem sem o modulo) — ok"

# chatwoot.env
if [[ ! -f "$CHATWOOT_ENV" ]]; then
  if [[ -f "$CHATWOOT_ENV.example" ]]; then
    cp "$CHATWOOT_ENV.example" "$CHATWOOT_ENV"
    chmod 600 "$CHATWOOT_ENV"
    secret=$(openssl rand -hex 64)
    sed -i "s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=$secret|" "$CHATWOOT_ENV"
    ok "Criado $CHATWOOT_ENV (lembre-se de preencher SMTP)"
  fi
fi

# Migrations do Chatwoot — primeira instalacao precisa rodar db:chatwoot_prepare
# (cria as tabelas portals, conversations, etc). Idempotente: se ja rodou,
# nao faz nada destrutivo.
if docker ps --format '{{.Names}}' | grep -q '^yugo-chatwoot$'; then
  log "Rodando db:chatwoot_prepare (migrations + seed Chatwoot)..."
  if docker exec yugo-chatwoot bundle exec rails db:chatwoot_prepare 2>&1 | tail -5; then
    ok "Migrations Chatwoot OK"
  else
    log "db:chatwoot_prepare falhou — provavel chatwoot ainda nao subiu; rodar depois manualmente"
  fi
fi

ok "Bootstrap dos servicos concluido."
ok "Suba os 3 servicos com:"
echo "  cd $REPO_DIR"
echo "  docker compose \\"
echo "    -f infra/docker/docker-compose.prod.yml \\"
echo "    -f infra/docker/docker-compose.services.yml \\"
echo "    --env-file infra/docker/.env.production \\"
echo "    up -d chatwoot chatwoot-sidekiq glpi-db glpi evolution"
echo ""
echo "Depois cadastre os subdominios no DNS:"
echo "  chatwoot.${DOMAIN:-yugochat.com.br}  A  178.105.111.15"
echo "  chamados.${DOMAIN:-yugochat.com.br}  A  178.105.111.15"
echo "  evo.${DOMAIN:-yugochat.com.br}       A  178.105.111.15"
