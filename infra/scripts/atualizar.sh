#!/usr/bin/env bash
# ==============================================================================
# atualizar.sh — atualiza o código do git e roda o deploy completo (1 comando).
#
# Uso no VPS (dentro do repo):
#   bash infra/scripts/atualizar.sh                 # usa main (padrão)
#   bash infra/scripts/atualizar.sh outra-branch    # ou outra branch
#
# Faz: git fetch + checkout + pull --ff-only da branch, depois deploy-prod.sh
# (que rebuilda api/web, aplica migrations e sobe a stack).
# ==============================================================================
set -euo pipefail

# O padrão era `dev`, uma branch que NÃO EXISTE no remoto (há `main` e as de
# trabalho). Rodar sem argumento morria no `git fetch origin dev` — falha alta
# e sem dano, mas o padrão mentia sobre o que o script fazia. `main` é o que
# realmente se quer quando ninguém diz nada.
BRANCH="${1:-main}"
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
# --no-pull NÃO é otimização: é o que impede o deploy de subir OUTRA branch.
#
# O `deploy-prod.sh`, no passo 1, faz `git pull --ff-only origin main` — com
# `main` CRAVADO. Chamado sem argumento, ele roda esse pull por cima da branch
# que o checkout acima acabou de deixar no diretório. Enquanto `main` for
# ancestral da branch, o pull é um "Already up to date" inofensivo; no dia em
# que `main` andar à frente, ele faz fast-forward da branch pra `main` e sobe
# o código da `main` — enquanto esta tela diz, acima, que subiu a branch.
#
# O git já foi feito aqui (fetch + checkout + pull da branch PEDIDA). Fazer de
# novo lá dentro, de outra branch, só pode dar errado.
bash "$SCRIPT_DIR/deploy-prod.sh" --no-pull

echo "==> Pronto. Estado dos containers:"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -i yugo || true
