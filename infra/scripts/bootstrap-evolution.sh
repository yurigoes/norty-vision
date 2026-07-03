#!/usr/bin/env bash
# ==============================================================================
# bootstrap-evolution.sh — cria SÓ o role + banco do Evolution no Postgres.
#
# Use quando rodar o Evolution (WhatsApp) sem Chatwoot/GLPI (VPS pequena).
# Idempotente. Roda na VPS, com o yugo-postgres no ar.
#
#   bash infra/scripts/bootstrap-evolution.sh
#   docker restart yugo-evolution
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../docker/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "Falta $ENV_FILE"; exit 1; }

get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
PGUSER="$(get_env POSTGRES_USER)"; PGUSER="${PGUSER:-yugo}"
EVPW="$(get_env EVOLUTION_DB_PASSWORD)"
[[ -n "$EVPW" ]] || { echo "ERRO: EVOLUTION_DB_PASSWORD vazio no .env"; exit 1; }

docker ps --format '{{.Names}}' | grep -q '^yugo-postgres$' || { echo "ERRO: yugo-postgres nao esta rodando"; exit 1; }

echo "==> Criando/atualizando role 'evolution'..."
docker exec -i yugo-postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evolution') THEN
    CREATE ROLE evolution LOGIN PASSWORD '$EVPW';
  ELSE
    ALTER ROLE evolution WITH PASSWORD '$EVPW';
  END IF;
END \$\$;
SQL

echo "==> Garantindo database 'evolution'..."
exists="$(docker exec -i yugo-postgres psql -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='evolution'" | tr -d '[:space:]')"
if [[ "$exists" != "1" ]]; then
  docker exec -i yugo-postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE evolution OWNER evolution"
  echo "    database criado."
else
  echo "    ja existe."
fi

echo "==> OK. Agora reinicie o Evolution:"
echo "    docker restart yugo-evolution"
echo "    docker logs -f yugo-evolution"
