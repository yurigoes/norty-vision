#!/usr/bin/env bash
# ==============================================================================
# ai-local-up.sh  —  Ativa a IA LOCAL (Ollama) na VPS, numa tacada.
#
# Roda na VPS, dentro do repo (ex.: /opt/yugo-platform). Idempotente.
#
# O que faz:
#   1. Detecta RAM e decide o que ligar:
#        - SEMPRE: memória semântica (embeddings bge-m3) — leve, roda sob demanda.
#        - CHAT local (Llama/Qwen) só se houver RAM (>= 6 GB) ou --with-chat.
#   2. Grava as variáveis no .env.production (idempotente).
#   3. Sobe o container ollama + baixa os modelos.
#   4. Recria api/web pra pegarem as variáveis novas.
#
# Uso:
#   bash infra/scripts/ai-local-up.sh                 # auto (embeddings; chat se couber)
#   bash infra/scripts/ai-local-up.sh --embeddings-only
#   bash infra/scripts/ai-local-up.sh --with-chat --model qwen2.5:3b
#   bash infra/scripts/ai-local-up.sh --off           # desliga (remove flag + para ollama)
#   FORCE=1 bash infra/scripts/ai-local-up.sh --with-chat   # ignora o guarda de RAM
#
# Depois: no painel da empresa → Atendimento · IA → "Indexar base (IA)".
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_RED=$'\033[31m' C_BLUE=$'\033[34m'
log()  { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$REPO_DIR/infra/docker"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.prod.yml"
AI_FILE="$COMPOSE_DIR/docker-compose.ai.yml"
ENV_FILE="$COMPOSE_DIR/.env.production"

# --- flags ------------------------------------------------------------------
MODE="auto"            # auto | embeddings | chat
CHAT_MODEL=""          # vazio = decide pela RAM
EMB_MODEL="bge-m3"
TURN_OFF=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --embeddings-only) MODE="embeddings" ;;
    --with-chat)       MODE="chat" ;;
    --model)           CHAT_MODEL="${2:-}"; shift ;;
    --emb-model)       EMB_MODEL="${2:-}"; shift ;;
    --off)             TURN_OFF=1 ;;
    -h|--help)         grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "flag desconhecida: $1 (use --help)" ;;
  esac
  shift
done

# --- pre-checks -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker nao instalado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 nao instalado"
[[ -f "$COMPOSE_FILE" ]] || die "faltou $COMPOSE_FILE"
[[ -f "$AI_FILE" ]]      || die "faltou $AI_FILE (atualize o repo: git pull)"
[[ -f "$ENV_FILE" ]]     || die "faltou $ENV_FILE (rode generate-secrets.sh / deploy-prod.sh antes)"

# upsert KEY=VAL no .env (idempotente)
upsert() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # usa | como delimitador (URLs têm /)
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}
unset_key() { sed -i "/^$1=/d" "$ENV_FILE"; }

COMPOSE=(docker compose -f "$COMPOSE_FILE" -f "$AI_FILE" --env-file "$ENV_FILE")

# --- desligar ---------------------------------------------------------------
if [[ "$TURN_OFF" == "1" ]]; then
  log "Desligando IA local..."
  upsert "AI_LOCAL_ENABLED" "0"
  unset_key "LOCAL_AI_URL"; unset_key "LOCAL_AI_MODEL"; unset_key "EMBEDDINGS_URL"
  docker stop yugo-ollama >/dev/null 2>&1 || true
  docker rm yugo-ollama yugo-ollama-pull >/dev/null 2>&1 || true
  warn "IA local desligada. Embeddings e chat local voltam a ficar OFF (degrada pro full-text + provedores de nuvem)."
  warn "Rode um deploy/redeploy da api pra ela reler o .env (ex.: BUILD=0 PULL=0 bash infra/scripts/deploy-prod.sh --no-pull)."
  exit 0
fi

# --- decide o que ligar pela RAM -------------------------------------------
TOTAL_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')"; TOTAL_MB="${TOTAL_MB:-0}"
log "RAM total detectada: ${TOTAL_MB} MB"

WANT_CHAT=0
case "$MODE" in
  embeddings) WANT_CHAT=0 ;;
  chat)       WANT_CHAT=1 ;;
  auto)       if (( TOTAL_MB >= 6000 )); then WANT_CHAT=1; else WANT_CHAT=0; fi ;;
esac

# guarda de RAM pro chat (modelo de chat come vários GB)
if (( WANT_CHAT == 1 )) && (( TOTAL_MB < 6000 )) && [[ "${FORCE:-0}" != "1" ]]; then
  warn "RAM (${TOTAL_MB} MB) baixa pro chat local — um modelo de chat pode derrubar a VPS."
  warn "Ligando SÓ embeddings. Pra forçar o chat assim mesmo: FORCE=1 ... --with-chat"
  WANT_CHAT=0
fi

# escolhe o modelo de chat pela RAM se não foi passado
if (( WANT_CHAT == 1 )) && [[ -z "$CHAT_MODEL" ]]; then
  if   (( TOTAL_MB >= 12000 )); then CHAT_MODEL="llama3.1:8b"
  elif (( TOTAL_MB >= 8000 ));  then CHAT_MODEL="qwen2.5:7b"
  else                               CHAT_MODEL="qwen2.5:3b"
  fi
fi

# --- grava .env (idempotente) ----------------------------------------------
log "Gravando variáveis no .env.production..."
upsert "AI_LOCAL_ENABLED" "1"
upsert "EMBEDDINGS_URL"   "http://ollama:11434"
upsert "EMBEDDINGS_MODEL" "$EMB_MODEL"
upsert "EMBEDDINGS_DIM"   "1024"
if (( WANT_CHAT == 1 )); then
  upsert "LOCAL_AI_URL"   "http://ollama:11434/v1"
  upsert "LOCAL_AI_MODEL" "$CHAT_MODEL"
  upsert "OLLAMA_PULL"    "$CHAT_MODEL $EMB_MODEL"
  ok "Modo: EMBEDDINGS ($EMB_MODEL) + CHAT local ($CHAT_MODEL)."
else
  # chat off: zera as vars de chat pra api não tentar usar
  unset_key "LOCAL_AI_URL"; unset_key "LOCAL_AI_MODEL"
  upsert "OLLAMA_PULL" "$EMB_MODEL"
  ok "Modo: SÓ EMBEDDINGS ($EMB_MODEL). Chat local desligado (fallback continua nos provedores de nuvem)."
fi

# --- sobe o ollama + baixa modelos -----------------------------------------
log "Subindo o container Ollama..."
"${COMPOSE[@]}" up -d ollama

log "Aguardando o Ollama ficar pronto..."
for _ in $(seq 1 30); do
  docker exec yugo-ollama ollama --version >/dev/null 2>&1 && break
  sleep 2
done

log "Baixando modelos (pode demorar — alguns GB)..."
"${COMPOSE[@]}" up ollama-pull || die "falha ao baixar modelos (veja o log acima)"

log "Modelos disponíveis no Ollama:"
docker exec yugo-ollama ollama list 2>/dev/null | sed 's/^/    /' || true

# --- recria api/web pra pegarem as variáveis novas --------------------------
log "Recriando api/web pra aplicar as variáveis (sem rebuild)..."
"${COMPOSE[@]}" up -d api web

# --- health -----------------------------------------------------------------
sleep 3
state=$(docker inspect --format='{{.State.Health.Status}}' yugo-api 2>/dev/null || echo "?")
ok "api: $state"

cat <<EOF

${C_GREEN}IA local ativada.${C_RESET}
  - Memória semântica (embeddings): ON  → modelo $EMB_MODEL
  - Chat local (fallback de plataforma): $([[ $WANT_CHAT == 1 ]] && echo "ON → $CHAT_MODEL" || echo "OFF (usa provedores de nuvem)")

Próximos passos:
  1. No painel da empresa → ${C_BLUE}Atendimento · IA${C_RESET} → botão "${C_BLUE}Indexar base (IA)${C_RESET}"
     pra gerar os vetores da base de conhecimento já publicada.
  2. (opcional) Cada empresa pode adicionar o provedor "Modelo local (Ollama/vLLM)"
     em Integrações, apontando http://ollama:11434/v1.

Para desligar:  bash infra/scripts/ai-local-up.sh --off
EOF
