#!/usr/bin/env bash
# ==============================================================================
# build-prod.sh - builda images Docker do api e web na VPS
#
# Pre-requisito: pnpm-lock.yaml existir. Se nao existir, este script gera
# rodando `pnpm install` em um container temporario.
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_GREEN=$'\033[32m'
readonly C_BLUE=$'\033[34m'
log() { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()  { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"

cd "$REPO_DIR"

# 1. garante pnpm-lock.yaml (build precisa)
if [[ ! -f "pnpm-lock.yaml" ]]; then
  log "pnpm-lock.yaml nao encontrado - gerando em container temporario..."
  docker run --rm \
    -v "$REPO_DIR":/repo \
    -w /repo \
    node:22-alpine \
    sh -c "corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --no-frozen-lockfile"
  ok "pnpm-lock.yaml gerado."
fi

# 2. buildar images
log "Buildando yugo/api e yugo/web..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api web

ok "Images buildadas. Suba com: bash infra/scripts/deploy-prod.sh"
