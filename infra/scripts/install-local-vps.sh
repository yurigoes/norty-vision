#!/usr/bin/env bash
# ==============================================================================
# install-local-vps.sh
#
# Provisiona uma VPS local (Debian 12) do zero ate yugo-platform rodando atras
# de Cloudflare Tunnel — a VPS cria o tunnel via API da Cloudflare. Voce so
# precisa entregar:
#   - CF_API_TOKEN   (API Token com escopos Tunnel:Edit + DNS:Edit)
#   - CF_ACCOUNT_ID  (no dashboard CF, sidebar direita)
#   - CF_ZONE_ID     (no Overview da zona local.yugochat.com.br)
#
# O resto (cria tunnel, configura ingress, cria CNAMEs, gera secrets, builda,
# sobe stack) o script faz sozinho.
#
# Idempotente — pode rodar varias vezes sem destruir nada.
#
# Variaveis:
#   CF_API_TOKEN         (obrigatorio) API Token Cloudflare
#   CF_ACCOUNT_ID        (obrigatorio) Account ID
#   CF_ZONE_ID           (obrigatorio) Zone ID da zona delegada
#   TUNNEL_BASE_DOMAIN   (obrigatorio) ex: local.yugochat.com.br
#   TUNNEL_NAME          default: yugo-local
#   ACME_EMAIL           default: admin@<base-domain>
#   WITH_SERVICES=1      tambem sobe chatwoot/glpi/evolution + cria CNAMEs deles
#   REPO_URL             default: https://github.com/yurigoes/yugo-platform.git
#   REPO_DIR             default: /opt/yugo-platform
#
# Uso:
#   CF_API_TOKEN='...' CF_ACCOUNT_ID='...' CF_ZONE_ID='...' \
#   TUNNEL_BASE_DOMAIN='local.yugochat.com.br' \
#   sudo -E bash install-local-vps.sh
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_RED=$'\033[31m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_BLUE=$'\033[34m'
readonly C_BOLD=$'\033[1m'

log()  { printf '%s[%s]%s %s\n' "$C_BLUE"  "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }
ask()  { printf '%s? %s%s ' "$C_BOLD" "$*" "$C_RESET"; }
section() { printf '\n%s========== %s ==========%s\n' "$C_BOLD" "$*" "$C_RESET"; }

[[ $EUID -eq 0 ]] || die "Rode como root ou via sudo."
. /etc/os-release 2>/dev/null || die "/etc/os-release ausente."
[[ "${ID:-}" == "debian" ]] || warn "Detectado $ID — testado em Debian 12."

REPO_URL="${REPO_URL:-https://github.com/yurigoes/yugo-platform.git}"
REPO_DIR="${REPO_DIR:-/opt/yugo-platform}"
TUNNEL_NAME="${TUNNEL_NAME:-yugo-local}"

prompt_if_empty() {
  local var="$1"
  local question="$2"
  # indireta segura sob set -u: testa se existe antes de expandir
  local current=""
  if eval "[[ -n \"\${${var}+x}\" ]]"; then
    eval "current=\"\$${var}\""
  fi
  if [[ -z "$current" ]]; then
    ask "$question"
    read -r "$var"
  fi
}

prompt_if_empty CF_API_TOKEN        "Cloudflare API Token (escopos Tunnel:Edit + DNS:Edit):"
prompt_if_empty CF_ACCOUNT_ID        "Cloudflare Account ID:"
prompt_if_empty CF_ZONE_ID           "Cloudflare Zone ID (da zona delegada):"
prompt_if_empty TUNNEL_BASE_DOMAIN   "Dominio base do tunnel (ex: local.yugochat.com.br):"

ACME_EMAIL="${ACME_EMAIL:-admin@${TUNNEL_BASE_DOMAIN#*.}}"

[[ -n "$CF_API_TOKEN"        ]] || die "CF_API_TOKEN obrigatorio."
[[ -n "$CF_ACCOUNT_ID"       ]] || die "CF_ACCOUNT_ID obrigatorio."
[[ -n "$CF_ZONE_ID"          ]] || die "CF_ZONE_ID obrigatorio."
[[ -n "$TUNNEL_BASE_DOMAIN"  ]] || die "TUNNEL_BASE_DOMAIN obrigatorio."

# ---------------------------------------------------------------------------
# 1. pacotes base
# ---------------------------------------------------------------------------
section "1/9  Pacotes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release git openssl \
  ufw fail2ban htop tmux vim less jq \
  > /dev/null
ok "pacotes base instalados"

# ---------------------------------------------------------------------------
# 2. Docker + Compose v2
# ---------------------------------------------------------------------------
section "2/9  Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
  systemctl enable --now docker
  ok "Docker instalado"
else
  ok "Docker ja presente: $(docker --version)"
fi

# ---------------------------------------------------------------------------
# 3. firewall (UFW) — em modo tunnel NAO precisa abrir 80/443
# ---------------------------------------------------------------------------
section "3/9  Firewall (UFW)"
if ! ufw status | grep -q "Status: active"; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  echo "y" | ufw enable
  ok "UFW habilitado (SSH apenas; tunnel sai do container)"
else
  ok "UFW ja ativo"
fi

# ---------------------------------------------------------------------------
# 4. clone / pull repo
# ---------------------------------------------------------------------------
section "4/9  Repo"
mkdir -p "$(dirname "$REPO_DIR")"
if [[ -d "$REPO_DIR/.git" ]]; then
  log "repo ja clonado, dando git pull..."
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" reset --hard origin/main
  ok "repo atualizado em $REPO_DIR"
else
  log "clonando $REPO_URL em $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR"
  ok "repo clonado"
fi

git -C "$REPO_DIR" config user.name  "yugo-platform local" 2>/dev/null || true
git -C "$REPO_DIR" config user.email "local@yugochat.com.br" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 5. provisiona Cloudflare Tunnel via API
# ---------------------------------------------------------------------------
section "5/9  Cloudflare Tunnel (via API)"
PROVISIONER="$REPO_DIR/infra/scripts/cloudflare-tunnel-provision.sh"
[[ -x "$PROVISIONER" ]] || chmod +x "$PROVISIONER"
[[ -f "$PROVISIONER" ]] || die "Falta $PROVISIONER (atualize o repo)"

# captura SO o stdout (token) — stderr (logs) flui normalmente
CLOUDFLARED_TOKEN=$(
  CF_API_TOKEN="$CF_API_TOKEN" \
  CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
  CF_ZONE_ID="$CF_ZONE_ID" \
  TUNNEL_BASE_DOMAIN="$TUNNEL_BASE_DOMAIN" \
  TUNNEL_NAME="$TUNNEL_NAME" \
  WITH_SERVICES="${WITH_SERVICES:-}" \
  WITH_WILDCARD="${WITH_WILDCARD:-1}" \
  bash "$PROVISIONER"
)
[[ -n "$CLOUDFLARED_TOKEN" ]] || die "Provisioner nao retornou token"
ok "Tunnel provisionado e DNS configurado"

# ---------------------------------------------------------------------------
# 6. .env.production (gera secrets + injeta token)
# ---------------------------------------------------------------------------
section "6/9  Secrets (.env.production)"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"
ENV_EXAMPLE="$REPO_DIR/infra/docker/.env.production.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$REPO_DIR/infra/scripts/generate-secrets.sh" ]]; then
    bash "$REPO_DIR/infra/scripts/generate-secrets.sh" --force
    ok ".env.production gerado pelo generate-secrets.sh"
  elif [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    while grep -q "CHANGE_ME_RUN_GENERATE_SECRETS" "$ENV_FILE"; do
      val=$(openssl rand -base64 36 | tr -d '\n=/+' | head -c 36)
      sed -i "0,/CHANGE_ME_RUN_GENERATE_SECRETS/s||${val}|" "$ENV_FILE"
    done
    ok ".env.production criado a partir do example"
  else
    die "Sem generate-secrets.sh nem example"
  fi
else
  ok ".env.production ja existe — preservando"
fi

set_env_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # escape sed: usar | como separador, escapar | no value
    local escaped="${value//|/\\|}"
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_env_var DOMAIN              "$TUNNEL_BASE_DOMAIN"
set_env_var ACME_EMAIL           "$ACME_EMAIL"
set_env_var CLOUDFLARED_TOKEN    "$CLOUDFLARED_TOKEN"
set_env_var TUNNEL_BASE_DOMAIN   "$TUNNEL_BASE_DOMAIN"
chmod 600 "$ENV_FILE"
ok "CLOUDFLARED_TOKEN injetado no .env.production"

# ---------------------------------------------------------------------------
# 7. build das images
# ---------------------------------------------------------------------------
section "7/9  Build (yugo/api + yugo/web)"
bash "$REPO_DIR/infra/scripts/build-prod.sh"

# ---------------------------------------------------------------------------
# 8a. subir infra basica (postgres/redis/minio/caddy/cloudflared) sem api/web
#     api/web precisam de YUGO_APP_PASSWORD que e gerado pelo db-apply
# ---------------------------------------------------------------------------
section "8/11  Infra basica (postgres/redis/minio/caddy/cloudflared)"
cd "$REPO_DIR/infra/docker"

COMPOSE_BASE=(-f docker-compose.prod.yml -f docker-compose.tunnel.yml)

docker compose "${COMPOSE_BASE[@]}" --env-file .env.production pull --ignore-pull-failures || true
docker compose "${COMPOSE_BASE[@]}" --env-file .env.production up -d \
  postgres redis minio caddy cloudflared minio-init

log "aguardando postgres ficar pronto..."
for i in {1..30}; do
  if docker exec yugo-postgres pg_isready -U yugo >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec yugo-postgres pg_isready -U yugo >/dev/null \
  || die "yugo-postgres nao respondeu em 60s"
ok "postgres pronto"

# ---------------------------------------------------------------------------
# 9. db-apply.sh (cria roles yugo_app/yugo_migrator, aplica SQL, grava
#    YUGO_APP_PASSWORD + YUGO_MIGRATOR_PASSWORD em .env.production)
# ---------------------------------------------------------------------------
section "9/11  Migrations + roles (db-apply.sh)"
if [[ -f "$REPO_DIR/infra/scripts/db-apply.sh" ]]; then
  bash "$REPO_DIR/infra/scripts/db-apply.sh"
  ok "migrations + roles aplicadas"
else
  die "db-apply.sh ausente"
fi

# ---------------------------------------------------------------------------
# 10. WITH_SERVICES: bootstrap-services gera DB+senhas pra chatwoot/glpi/evo
# ---------------------------------------------------------------------------
COMPOSE_FILES=("${COMPOSE_BASE[@]}")

if [[ "${WITH_SERVICES:-}" == "1" ]]; then
  if [[ -f "$REPO_DIR/infra/scripts/bootstrap-services.sh" ]]; then
    section "10/11  Bootstrap chatwoot/glpi/evolution"
    bash "$REPO_DIR/infra/scripts/bootstrap-services.sh"
    ok "secrets gerados (chatwoot.env + senhas em .env.production)"
  fi
fi

# ---------------------------------------------------------------------------
# 11. sobe api/web + services (agora YUGO_APP_PASSWORD existe)
# ---------------------------------------------------------------------------
section "11/12  Subindo api + web + (services)"
if [[ "${WITH_SERVICES:-}" == "1" && -f docker-compose.services.yml ]]; then
  COMPOSE_FILES+=(-f docker-compose.services.yml)
fi
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production pull --ignore-pull-failures || true
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production up -d --no-deps \
  postgres redis minio caddy cloudflared minio-init api web \
  $([[ "${WITH_SERVICES:-}" == "1" ]] && echo "chatwoot chatwoot-sidekiq glpi-db glpi evolution") \
  2>&1 | tail -30 || true
ok "containers iniciados"

# ---------------------------------------------------------------------------
# 12. migrations dos services (chatwoot precisa pos-boot)
# ---------------------------------------------------------------------------
if [[ "${WITH_SERVICES:-}" == "1" ]]; then
  section "12/12  Migrations dos services (chatwoot)"

  # pg_stat_statements pro chatwoot
  POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env.production | cut -d= -f2-)
  POSTGRES_USER=$(grep -E '^POSTGRES_USER=' .env.production | cut -d= -f2-)
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" yugo-postgres \
    psql -U "$POSTGRES_USER" -d chatwoot -v ON_ERROR_STOP=0 -c \
    "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" >/dev/null 2>&1 || true

  # aguarda yugo-chatwoot rodando (mesmo nao saudavel)
  log "aguardando yugo-chatwoot iniciar..."
  for i in {1..30}; do
    if docker ps --format '{{.Names}}' | grep -q '^yugo-chatwoot$'; then break; fi
    sleep 2
  done

  if docker ps --format '{{.Names}}' | grep -q '^yugo-chatwoot$'; then
    log "Rodando db:chatwoot_prepare (pode demorar 1-2min)..."
    if docker exec yugo-chatwoot bundle exec rails db:chatwoot_prepare 2>&1 | tail -15; then
      ok "Chatwoot migrations OK — reiniciando container"
      docker compose "${COMPOSE_FILES[@]}" --env-file .env.production \
        restart chatwoot chatwoot-sidekiq 2>&1 | tail -5
    else
      warn "db:chatwoot_prepare falhou — rode manualmente:"
      warn "  docker exec yugo-chatwoot bundle exec rails db:chatwoot_prepare"
    fi
  else
    warn "yugo-chatwoot nao apareceu — execute db:chatwoot_prepare manualmente depois"
  fi
fi

ok "stack completa de pe"

# ---------------------------------------------------------------------------
# pronto
# ---------------------------------------------------------------------------
section "Concluido"
docker compose "${COMPOSE_FILES[@]}" --env-file .env.production ps
echo
ok "Stack rodando atras de Cloudflare Tunnel"
echo
log "URLs publicas:"
HOSTS="app api"
[[ "${WITH_SERVICES:-}" == "1" ]] && HOSTS="$HOSTS chatwoot chamados evo"
for sub in $HOSTS; do
  log "  https://${sub}.${TUNNEL_BASE_DOMAIN}"
done
echo
log "Logs cloudflared:"
log "  docker logs -f yugo-cloudflared"
log "Re-rodar (idempotente):"
log "  CF_API_TOKEN=... CF_ACCOUNT_ID=... CF_ZONE_ID=... TUNNEL_BASE_DOMAIN=... sudo -E bash $0"
