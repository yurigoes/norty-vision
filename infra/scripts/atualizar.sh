#!/usr/bin/env bash
# ==============================================================================
# atualizar.sh — atualiza o código do git e roda o deploy completo (1 comando).
#
# Uso no VPS (dentro do repo):
#   bash infra/scripts/atualizar.sh           # usa a branch dev (padrão)
#   bash infra/scripts/atualizar.sh main      # ou outra branch
#
# Faz: git fetch + checkout + pull --ff-only da branch, depois deploy-prod.sh
# (que rebuilda api/web, aplica migrations e sobe a stack).
# ==============================================================================
set -euo pipefail

BRANCH="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_DIR"

echo "==> Atualizando código (branch: $BRANCH)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Commit atual:"
git --no-pager log --oneline -1

# Garante swap antes do build (next/nest build estoura a RAM em VPS pequena e
# pode REINICIAR a máquina sem swap). Best-effort: não bloqueia o deploy.
echo "==> Verificando swap (anti-OOM no build)"
bash "$SCRIPT_DIR/ensure-swap.sh" 4 || echo "   (não consegui ajustar swap — seguindo)"

echo "==> Rodando deploy (build + migrations + up)"
bash "$SCRIPT_DIR/deploy-prod.sh"

echo "==> Pronto. Estado dos containers:"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -i yugo || true
