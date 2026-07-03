#!/usr/bin/env bash
# ==============================================================================
# norty-generate-secrets.sh — gera infra/docker/.env.norty com senhas fortes.
#
# Espelho do generate-secrets.sh, mas pro stack AUTOCONTIDO do Norty Vision
# (nv-postgres/redis/minio). Idempotente: aborta se .env.norty já existe
# (use --force pra rotacionar).
#
# Uso:
#   cd /opt/norty-vision/infra/docker
#   DOMAIN=vision.norty.com.br ../scripts/norty-generate-secrets.sh
# ==============================================================================
set -euo pipefail

readonly C_RESET=$'\033[0m'; readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'; readonly C_RED=$'\033[31m'
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
ENV_FILE="$COMPOSE_DIR/.env.norty"

force="${1:-}"
if [[ -f "$ENV_FILE" && "$force" != "--force" ]]; then
  warn "$ENV_FILE já existe. Rode com --force pra regenerar (rotação). ABORTANDO."
  exit 1
fi

gen() { openssl rand -base64 "${1:-32}" | tr -d '\n=/+' | head -c "${2:-40}"; }

POSTGRES_PASSWORD=$(gen 48 48)
REDIS_PASSWORD=$(gen 48 48)
MINIO_ROOT_PASSWORD=$(gen 48 48)
AUTH_SECRET=$(gen 64 80)
RUNBOOK_PASSWORD=$(gen 16 16)
LICENSE_TOKEN="nvlic_$(openssl rand -hex 32)"

DOMAIN_VAL="${DOMAIN:-vision.norty.com.br}"

umask 077
cat > "$ENV_FILE" <<EOF
# Gerado por norty-generate-secrets.sh em $(date -Is)
# NUNCA COMMITE ESTE ARQUIVO. Backup criptografado em outro lugar.

NORTY_BASE_DOMAIN=$DOMAIN_VAL

# --- Postgres (nv-postgres) ---
POSTGRES_DB=norty_vision
POSTGRES_USER=norty
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
# YUGO_APP_PASSWORD / YUGO_MIGRATOR_PASSWORD gravados pelo norty-db-apply.sh

# --- Redis (nv-redis) ---
REDIS_PASSWORD=$REDIS_PASSWORD

# --- MinIO (nv-minio) ---
MINIO_ROOT_USER=norty-admin
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
MINIO_BUCKET=norty-vision

# --- Auth ---
AUTH_SECRET=$AUTH_SECRET

# --- Plataforma ---
PLATFORM_ORG_SLUG=norty-vision
RUNBOOK_PASSWORD=$RUNBOOK_PASSWORD

# --- Norty Vision: identidade + licença ---
NORTY_SYSTEM_NAME=Norty Vision
NORTY_LICENSE_TOKEN=$LICENSE_TOKEN

# --- Cloudflare Tunnel (PREENCHER MANUALMENTE) ---
NORTY_CLOUDFLARED_TOKEN=

# --- SMTP (opcional) ---
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Norty Vision <no-reply@$DOMAIN_VAL>

# --- Anthropic (opcional) ---
ANTHROPIC_API_KEY=
EOF

chmod 600 "$ENV_FILE"
ok "Gerado: $ENV_FILE (modo 600)"
warn "Preencha NORTY_CLOUDFLARED_TOKEN antes de subir o nv-cloudflared."
ok "NORTY_LICENSE_TOKEN gerado: use-o no Norty (Sistemas→Gerenciar → Base URL/Token)."
