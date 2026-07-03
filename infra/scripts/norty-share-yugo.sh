#!/usr/bin/env bash
# ==============================================================================
# norty-share-yugo.sh — migra o Norty Vision pra COMPARTILHAR Postgres/Redis/MinIO
# do yugo-platform (em vez de subir nv-postgres/nv-redis/nv-minio próprios).
#
# O que faz (idempotente):
#   1) lê os segredos COMPARTILHADOS do .env.production do yugo (roles do banco,
#      senha do redis, credenciais do minio) e injeta no .env.norty — sem imprimir;
#   2) cria o DATABASE `norty_vision` no yugo-postgres (reusa os roles yugo_app /
#      yugo_migrator que já existem lá — NÃO recria/reseta senha deles);
#   3) aplica extensões + migrations (packages/db/sql) no norty_vision;
#   4) cria os buckets do Norty no yugo-minio;
#   5) derruba os serviços de dados duplicados (nv-postgres/redis/minio) + volumes;
#   6) sobe nv-api/nv-web/nv-caddy apontando pro stack do yugo.
#
# Roda na VPS: bash /opt/norty-vision/infra/scripts/norty-share-yugo.sh
# ==============================================================================
set -euo pipefail

log() { printf '\033[34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()  { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[ERR]\033[0m %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_DIR="$REPO_DIR/packages/db/sql"
DOCKER_DIR="$REPO_DIR/infra/docker"
ENV_NORTY="$DOCKER_DIR/.env.norty"
ENV_YUGO="${YUGO_ENV:-/opt/yugo-platform/infra/docker/.env.production}"

YUGO_PG=yugo-postgres
YUGO_MINIO=yugo-minio
NV_DB=norty_vision
NV_BUCKET_PRIVATE=norty-vision-private
NV_BUCKET_PUBLIC=norty-vision-public

[[ -f "$ENV_NORTY" ]] || die "Falta $ENV_NORTY (rode norty-generate-secrets.sh antes)."
[[ -f "$ENV_YUGO" ]]  || die "Não achei o .env do yugo em $ENV_YUGO (defina YUGO_ENV=...)."
[[ -d "$SQL_DIR" ]]   || die "Diretório SQL não encontrado: $SQL_DIR"
docker ps --format '{{.Names}}' | grep -q "^${YUGO_PG}$"    || die "$YUGO_PG não está rodando."
docker ps --format '{{.Names}}' | grep -q "^${YUGO_MINIO}$" || die "$YUGO_MINIO não está rodando."

envget() { grep -E "^${1}=" "$2" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

# --- 1) puxa os segredos compartilhados do yugo (não imprime) ---
APP_PW=$(envget YUGO_APP_PASSWORD "$ENV_YUGO")
MIG_PW=$(envget YUGO_MIGRATOR_PASSWORD "$ENV_YUGO")
REDIS_PW=$(envget REDIS_PASSWORD "$ENV_YUGO")
MINIO_USER=$(envget MINIO_ROOT_USER "$ENV_YUGO")
MINIO_PW=$(envget MINIO_ROOT_PASSWORD "$ENV_YUGO")
[[ -n "$APP_PW" && -n "$MIG_PW" && -n "$REDIS_PW" && -n "$MINIO_USER" && -n "$MINIO_PW" ]] \
  || die "Faltam segredos compartilhados no $ENV_YUGO (APP/MIGRATOR/REDIS/MINIO)."

# --- 2) reescreve o .env.norty pros valores compartilhados (idempotente) ---
setenv() {  # setenv KEY VALUE
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_NORTY"; then
    # usa | como delimitador; escapa | e & no valor
    local esc; esc=$(printf '%s' "$v" | sed 's/[|&]/\\&/g')
    sed -i "s|^${k}=.*|${k}=${esc}|" "$ENV_NORTY"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_NORTY"
  fi
}
umask 077
setenv POSTGRES_DB "$NV_DB"
setenv MINIO_BUCKET "$NV_BUCKET_PRIVATE"
setenv YUGO_APP_PASSWORD "$APP_PW"
setenv YUGO_MIGRATOR_PASSWORD "$MIG_PW"
setenv REDIS_PASSWORD "$REDIS_PW"
setenv MINIO_ROOT_USER "$MINIO_USER"
setenv MINIO_ROOT_PASSWORD "$MINIO_PW"
ok ".env.norty apontado pro stack compartilhado do yugo (segredos herdados, não impressos)."

# --- 3) cria o DB norty_vision + grants + schema no yugo-postgres ---
SU()  { docker exec -i "$YUGO_PG" psql -U yugo -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
MIG() { docker exec -i -e PGPASSWORD="$MIG_PW" "$YUGO_PG" psql -U yugo_migrator -d "$NV_DB" -v ON_ERROR_STOP=1 "$@"; }

if ! SU postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$NV_DB'" | grep -q 1; then
  log "criando DATABASE $NV_DB no $YUGO_PG"
  SU postgres -c "CREATE DATABASE $NV_DB"
else
  log "DATABASE $NV_DB já existe — segue idempotente"
fi

log "grants + extensões (reusa roles yugo_app/yugo_migrator existentes; NÃO mexe nas senhas deles)"
# Aplica APENAS a parte de GRANTS do 000_roles.sql (sem CREATE/ALTER ROLE, pra não
# tocar nas senhas dos roles compartilhados do yugo). Dá CREATE em schema public
# pro yugo_migrator (senão PG16 nega a criação das tabelas).
SU "$NV_DB" >/dev/null <<'SQL'
GRANT CONNECT, CREATE ON DATABASE norty_vision TO yugo_app, yugo_migrator;
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA public, app TO yugo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yugo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yugo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO yugo_app;
GRANT ALL ON SCHEMA public, app TO yugo_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO yugo_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO yugo_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO yugo_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO yugo_migrator;
SQL
[[ -f "$SQL_DIR/001_extensions.sql" ]] && SU "$NV_DB" < "$SQL_DIR/001_extensions.sql" >/dev/null

log "aplicando migrations em $NV_DB (pulando 000_roles.sql pra não tocar nos roles do yugo)"
for f in $(ls "$SQL_DIR"/*.sql | sort); do
  b=$(basename "$f")
  case "$b" in
    000_roles.sql|001_extensions.sql) continue ;;
    *grants*|*roles*) SU "$NV_DB" < "$f" >/dev/null ;;
    *)                MIG < "$f" >/dev/null ;;
  esac
  ok "  $b"
done
TBLS=$(MIG -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname='public'")
ok "schema aplicado em $NV_DB ($TBLS tabelas)."

# --- 4) buckets do Norty no yugo-minio ---
log "criando buckets no $YUGO_MINIO"
docker exec -i -e MC_USER="$MINIO_USER" -e MC_PW="$MINIO_PW" "$YUGO_MINIO" sh -c '
  mc alias set nv http://localhost:9000 "$MC_USER" "$MC_PW" >/dev/null 2>&1 || \
  { command -v mc >/dev/null || { echo "mc ausente no container minio — usando mc externo"; exit 42; }; }
' || {
  # o container minio/minio não traz o cliente mc; usa a imagem minio/mc no network
  docker run --rm --network yugo-internal -e MC_USER="$MINIO_USER" -e MC_PW="$MINIO_PW" \
    minio/mc:RELEASE.2024-11-21T17-21-54Z sh -c '
      set -e
      mc alias set nv http://minio:9000 "$MC_USER" "$MC_PW"
      mc mb --ignore-existing nv/'"$NV_BUCKET_PRIVATE"'
      mc mb --ignore-existing nv/'"$NV_BUCKET_PUBLIC"'
      mc anonymous set download nv/'"$NV_BUCKET_PUBLIC"'
    '
}
ok "buckets $NV_BUCKET_PRIVATE (privado) + $NV_BUCKET_PUBLIC (público) prontos."

# --- 5) derruba os serviços de dados duplicados + volumes ---
log "removendo serviços de dados duplicados (nv-postgres/redis/minio)"
for c in nv-minio-init nv-postgres nv-redis nv-minio; do
  docker rm -f "$c" >/dev/null 2>&1 || true
done
for v in norty-postgres-data norty-redis-data norty-minio-data; do
  docker volume rm "$v" >/dev/null 2>&1 && ok "  volume $v removido" || true
done

# --- 6) sobe o stack compartilhado ---
cd "$DOCKER_DIR"
log "buildando + subindo nv-api/nv-web/nv-caddy/nv-cloudflared (stack compartilhado)"
docker compose -f docker-compose.norty.yml --env-file .env.norty up -d --build nv-api nv-web nv-caddy nv-cloudflared
ok "Norty Vision agora compartilha Postgres/Redis/MinIO com o yugo. Sem duplicação."
docker compose -f docker-compose.norty.yml --env-file .env.norty ps
