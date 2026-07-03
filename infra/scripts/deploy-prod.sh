#!/usr/bin/env bash
# ==============================================================================
# deploy-prod.sh - bootstrap/update do stack de producao
#
# Roda na VPS dentro de /opt/yugo-platform.
#
# Etapas:
#   1. git pull (se nao for --no-pull)
#   2. valida .env.production (existencia + chaves nao-default)
#   3. docker compose pull (imagens novas, se houver)
#   4. docker compose up -d (idempotente)
#   5. health-check pos-deploy
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
COMPOSE_DIR="$REPO_DIR/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.prod.yml"
SERVICES_FILE="$COMPOSE_DIR/docker-compose.services.yml"
EVOLUTION_FILE="$COMPOSE_DIR/docker-compose.evolution.yml"
TUNNEL_FILE="$COMPOSE_DIR/docker-compose.tunnel.yml"
AI_FILE="$COMPOSE_DIR/docker-compose.ai.yml"
FACE_FILE="$COMPOSE_DIR/docker-compose.face.yml"
VOIP_FILE="$COMPOSE_DIR/docker-compose.voip.yml"
ENV_FILE="$COMPOSE_DIR/.env.production"

# --- pre-checks -------------------------------------------------------------
[[ -f "$COMPOSE_FILE" ]] || die "Faltou $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "Faltou $ENV_FILE. Rode generate-secrets.sh primeiro."

# --- detecta modo (tunnel + services) ---------------------------------------
COMPOSE_ARGS=(-f "$COMPOSE_FILE")

# Chatwoot/GLPI (pesados): só se CHATWOOT_DB_PASSWORD ou GLPI_DB_PASSWORD tiver
# valor NÃO-VAZIO. (apagar o valor desliga; antes o grep casava com a linha vazia)
if [[ -f "$SERVICES_FILE" ]] && grep -qE '^(CHATWOOT_DB_PASSWORD|GLPI_DB_PASSWORD)=.+' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$SERVICES_FILE")
  log "modo: incluindo Chatwoot/GLPI (services)"
fi

# Evolution (WhatsApp, leve): arquivo próprio, ligado independente do Chatwoot/GLPI.
# Inclui se EVOLUTION_API_KEY tiver valor não-vazio.
if [[ -f "$EVOLUTION_FILE" ]] && grep -qE '^EVOLUTION_API_KEY=.+' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$EVOLUTION_FILE")
  log "modo: incluindo Evolution (WhatsApp)"
fi

# Inclui tunnel se CLOUDFLARED_TOKEN existe
if [[ -f "$TUNNEL_FILE" ]] && grep -qE '^CLOUDFLARED_TOKEN=[^[:space:]]+' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$TUNNEL_FILE")
  log "modo: tunnel Cloudflare (Caddy http-only + cloudflared)"
fi

# IA local (Ollama): inclui se AI_LOCAL_ENABLED=1 no .env (embeddings e/ou chat).
# Ativada pelo script infra/scripts/ai-local-up.sh (grava a flag + sobe o overlay).
if [[ -f "$AI_FILE" ]] && grep -qE '^AI_LOCAL_ENABLED=1' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$AI_FILE")
  log "modo: incluindo IA local (Ollama)"
fi

# Reconhecimento facial local (DeepFace): inclui se FACE_LOCAL_ENABLED=1 no .env.
if [[ -f "$FACE_FILE" ]] && grep -qE '^FACE_LOCAL_ENABLED=1' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$FACE_FILE")
  log "modo: incluindo reconhecimento facial local (yugo-face)"
fi

# VoIP interno (FreeSWITCH + coturn): inclui se VOIP_ENABLED=1 no .env.
# Fase B.2 — ramais WebRTC entre operadores. Pre-requisitos antes de ligar:
# DNS+Caddy voip.yugochat.com.br->7443, VOIP_* no .env, firewall UDP (ver
# infra/voip/README.md). FreeSWITCH/coturn usam network_mode: host.
if [[ -f "$VOIP_FILE" ]] && grep -qE '^VOIP_ENABLED=1' "$ENV_FILE"; then
  COMPOSE_ARGS+=(-f "$VOIP_FILE")
  log "modo: incluindo VoIP interno (FreeSWITCH + coturn)"
fi

# bloqueia se algum CHANGE_ME ficou no arquivo
if grep -q "CHANGE_ME" "$ENV_FILE"; then
  die ".env.production ainda tem CHANGE_ME. Rode generate-secrets.sh."
fi

# precisa ter docker
command -v docker >/dev/null 2>&1 || die "docker nao instalado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 nao instalado"

# --- 1. git pull (a menos que --no-pull) ------------------------------------
case "${1:-}" in
  --no-pull) log "Pulando git pull (--no-pull)" ;;
  *)
    log "git pull..."
    cd "$REPO_DIR"
    git fetch --quiet origin main
    if [[ -n "$(git status --porcelain)" ]]; then
      warn "Diretorio com modificacoes locais. NAO vou rebase pra nao perder nada."
      git status --short
      die "Limpe (git stash ou commit) antes de prosseguir, ou use --no-pull."
    fi
    git pull --ff-only origin main
    ok "Codigo atualizado."
    ;;
esac

# --- 2. pull imagens de terceiros (postgres/redis/etc). api/web sao LOCAIS -
# PULL=0 pula este passo (ex.: imagens ja presentes / Docker Hub lento ou com
# rate-limit). O `up -d` mais adiante baixa sozinho qualquer imagem que falte.
if [[ "${PULL:-1}" == "1" ]]; then
  log "Baixando imagens de terceiros (docker compose pull)... [PULL=0 pula]"
  # timeout evita travar pra sempre num registry lento; se estourar, segue o baile
  timeout "${PULL_TIMEOUT:-300}" \
    docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" pull --ignore-pull-failures \
    || warn "pull demorou/falhou — seguindo (o up -d baixa o que faltar)."
else
  warn "PULL=0 — pulando docker compose pull (imagens de terceiros)."
fi

# --- 2b. REBUILD das imagens locais (api/web) com o codigo novo -------------
# CRÍTICO: api e web sao buildadas localmente. Sem este build, o `up -d`
# reaproveita a imagem ANTIGA e o git pull nao tem efeito no que roda.
# Use BUILD=0 pra pular (ex.: só reiniciar sem mudar codigo).
# servicos pesados que disputam RAM com o build (Chatwoot/GLPI/Evolution).
# Sao PARADOS durante o build e o `up -d` la embaixo os religa. `stop` nao
# apaga nada — volumes/dados ficam intactos. FREE_RAM_FOR_BUILD=0 desliga.
HEAVY_SVCS=(yugo-chatwoot yugo-chatwoot-sidekiq yugo-glpi yugo-glpi-db yugo-evolution yugo-ollama yugo-face)
HEAVY_STOPPED=0
if [[ "${BUILD:-1}" == "1" ]]; then
  if [[ "${FREE_RAM_FOR_BUILD:-1}" == "1" ]]; then
    log "Liberando RAM pro build: parando servicos pesados (religam no up -d)..."
    docker stop "${HEAVY_SVCS[@]}" >/dev/null 2>&1 || true
    HEAVY_STOPPED=1
    free -h 2>/dev/null | sed 's/^/    /' || true
  fi
  log "Rebuildando imagens locais (api, web) com o codigo atual..."
  if [[ ! -f "$REPO_DIR/pnpm-lock.yaml" ]]; then
    log "pnpm-lock.yaml ausente — gerando em container temporario..."
    docker run --rm -v "$REPO_DIR":/app -w /app node:20-bookworm-slim \
      sh -c "corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --no-frozen-lockfile" || true
  fi
  # SEQUENCIAL de proposito: api e web buildando ao mesmo tempo dobram o uso de
  # RAM e podem travar a VPS inteira (swap thrashing). Um de cada vez.
  log "Buildando api..."
  docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" build api
  log "Buildando web (next build com teto de RAM)..."
  docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" build web
  ok "Imagens api/web rebuildadas."
else
  warn "BUILD=0 — pulando rebuild (vai subir a imagem existente)."
fi

# --- 3. infra base PRIMEIRO (postgres/redis/minio) --------------------------
# A api só fica healthy depois que o db-apply cria o role yugo_app e gera o
# YUGO_APP_PASSWORD. Por isso subimos a infra, migramos, e SÓ DEPOIS a api/web —
# senão a api entra em loop de "senha em branco" e o up -d aborta.
log "Subindo infra base (postgres/redis/minio)..."
docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" up -d postgres redis minio

# --- 3b. migrations ANTES da api (cria roles + YUGO_APP_PASSWORD no .env) ----
if [[ "${RUN_MIGRATIONS:-1}" == "1" ]]; then
  log "Aguardando Postgres aceitar conexoes..."
  for _ in $(seq 1 30); do
    docker exec yugo-postgres pg_isready -q >/dev/null 2>&1 && break
    sleep 2
  done
  log "Aplicando migrations (db-apply.sh)..."
  if bash "$SCRIPT_DIR/db-apply.sh"; then
    ok "Migrations aplicadas (roles + YUGO_APP_PASSWORD gravados no .env)."
  else
    die "Falha ao aplicar migrations (db-apply.sh). Veja o erro acima."
  fi
else
  warn "RUN_MIGRATIONS=0 — pulando migrations. Rode 'bash infra/scripts/db-apply.sh' manualmente."
fi

# --- 3c. stack completa (api/web ja pegam YUGO_APP_PASSWORD do banco) --------
log "Subindo a stack completa (docker compose up -d)..."
docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" up -d --remove-orphans

# --- 4. health-check --------------------------------------------------------
log "Aguardando containers ficarem saudaveis..."
sleep 5
for svc in postgres redis minio caddy api; do
  state=$(docker inspect --format='{{.State.Health.Status}}' "yugo-$svc" 2>/dev/null || echo "no-healthcheck")
  if [[ "$state" == "healthy" || "$state" == "no-healthcheck" ]]; then
    ok "$svc: $state"
  else
    warn "$svc: $state (rodar: docker logs yugo-$svc)"
  fi
done

# --- 5. status final --------------------------------------------------------
log "Status final:"
docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" ps

# --- 6. teste basico --------------------------------------------------------
DOMAIN_VAL=$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)
TUNNEL_MODE=0
for a in "${COMPOSE_ARGS[@]}"; do [[ "$a" == *tunnel* ]] && TUNNEL_MODE=1; done

if [[ "$TUNNEL_MODE" == "1" ]]; then
  # em modo tunnel testa via docker network direto no caddy (CF pode demorar)
  log "Testando health via Caddy interno (modo tunnel)..."
  if docker exec yugo-caddy wget -qO- --header="Host: $DOMAIN_VAL" http://localhost/health >/dev/null 2>&1; then
    ok "Caddy responde no Host $DOMAIN_VAL"
  else
    warn "Caddy nao respondeu (rodar: docker logs yugo-caddy)"
  fi
else
  log "Testando https://$DOMAIN_VAL/health (pode demorar ate o cert sair)..."
  for i in 1 2 3; do
    if curl -fsS --max-time 8 "https://$DOMAIN_VAL/health" >/dev/null 2>&1; then
      ok "https://$DOMAIN_VAL/health respondeu 200"
      break
    fi
    warn "tentativa $i/3 falhou (cert pode estar sendo emitido), aguardando 10s..."
    sleep 10
  done
fi

ok "Deploy concluido."
log "Logs: docker compose ${COMPOSE_ARGS[*]} --env-file $ENV_FILE logs -f caddy"
