#!/usr/bin/env bash
# ==============================================================================
# generate-secrets.sh - gera .env.production com senhas fortes
#
# Roda 1x na VPS antes do primeiro 'docker compose up'.
# Idempotente: se .env.production ja existe, pergunta antes de sobrescrever.
#
# Uso:
#   cd /opt/yugo-platform/infra/docker
#   ../scripts/generate-secrets.sh [--force]
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_RED=$'\033[31m'

ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }

# decide o diretorio do docker compose
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
ENV_FILE="$COMPOSE_DIR/.env.production"
ENV_EXAMPLE="$COMPOSE_DIR/.env.production.example"

force="${1:-}"

if [[ -f "$ENV_FILE" && "$force" != "--force" ]]; then
  warn "$ENV_FILE ja existe."
  warn "Para regenerar (rotacao de secrets), rode com --force. ABORTANDO para nao perder senhas."
  exit 1
fi

[[ -f "$ENV_EXAMPLE" ]] || { err "Falta $ENV_EXAMPLE"; exit 1; }

# gerador
gen() { openssl rand -base64 "${1:-32}" | tr -d '\n=/+' | head -c "${2:-40}"; }

POSTGRES_PASSWORD=$(gen 48 48)
REDIS_PASSWORD=$(gen 48 48)
MINIO_ROOT_PASSWORD=$(gen 48 48)
AUTH_SECRET=$(gen 64 80)
RUNBOOK_PASSWORD=$(gen 16 16)
CHATWOOT_DB_PASSWORD=$(gen 32 32)
EVOLUTION_API_KEY=$(gen 32 32)
EVOLUTION_DB_PASSWORD=$(gen 32 32)
GLPI_DB_PASSWORD=$(gen 32 32)
GLPI_DB_ROOT_PASSWORD=$(gen 32 32)

# permite override por env var (util pra trocar dominio)
DOMAIN_VAL="${DOMAIN:-yugochat.com.br}"
ACME_EMAIL_VAL="${ACME_EMAIL:-admin@yugochat.com.br}"

umask 077   # arquivo nasce 600
cat > "$ENV_FILE" <<EOF
# Gerado por generate-secrets.sh em $(date -Is)
# NUNCA COMMITE ESTE ARQUIVO. Mantenha backup criptografado em outro lugar.

# --- dominio + Let's Encrypt ---
DOMAIN=$DOMAIN_VAL
ACME_EMAIL=$ACME_EMAIL_VAL

# --- Postgres ---
POSTGRES_DB=yugo
POSTGRES_USER=yugo
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# --- Redis ---
REDIS_PASSWORD=$REDIS_PASSWORD

# --- MinIO ---
MINIO_ROOT_USER=yugo-admin
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
MINIO_BUCKET=yugo-platform

# --- Auth (app) ---
AUTH_SECRET=$AUTH_SECRET
# YUGO_APP_PASSWORD / YUGO_MIGRATOR_PASSWORD sao gerados/gravados pelo db-apply.sh

# --- Plataforma ---
PLATFORM_ORG_SLUG=yugo
# senha da pagina Suporte -> Recuperacao & Backup (runbook), so master
RUNBOOK_PASSWORD=$RUNBOOK_PASSWORD

# --- Cloudflare tunnel (PREENCHER MANUALMENTE) ---
# Token do tunnel em: Cloudflare -> Zero Trust -> Networks -> Tunnels -> seu tunnel.
# Sem CLOUDFLARED_TOKEN preenchido, o deploy NAO ativa o modo tunnel.
CLOUDFLARED_TOKEN=
TUNNEL_BASE_DOMAIN=$DOMAIN_VAL

# --- Servicos pesados (Chatwoot / Evolution / GLPI) ---
# Se NAO quiser subir esses servicos, deixe as 3 *_DB_PASSWORD vazias que o
# deploy sobe so o nucleo (api/web/postgres/redis/minio/caddy).
CHATWOOT_DB_PASSWORD=$CHATWOOT_DB_PASSWORD
EVOLUTION_API_KEY=$EVOLUTION_API_KEY
EVOLUTION_DB_PASSWORD=$EVOLUTION_DB_PASSWORD
GLPI_DB_PASSWORD=$GLPI_DB_PASSWORD
GLPI_DB_ROOT_PASSWORD=$GLPI_DB_ROOT_PASSWORD

# --- SMTP (opcional; e-mail tambem pode ser configurado por empresa no painel) ---
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# --- Anthropic (preencher manualmente quando necessario) ---
ANTHROPIC_API_KEY=
EOF

chmod 600 "$ENV_FILE"

ok "Gerado: $ENV_FILE (modo 600)"
ok "Faca backup deste arquivo num lugar seguro (gerenciador de senhas, vault)."
ok "Para rotacionar futuramente, rode: $0 --force"
