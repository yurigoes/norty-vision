#!/usr/bin/env bash
# ==============================================================================
# restore-volumes.sh — restaura os dados na VPS NOVA.
#
# Pre-requisitos na VPS nova:
#   1. Docker instalado.
#   2. Repo clonado em /opt/yugo-platform (git clone).
#   3. O tarball gerado pelo backup-volumes.sh copiado pra ca.
#
# Uso:  bash infra/scripts/restore-volumes.sh /opt/yugo-backup-XXXX.tar.gz
#
# Depois de restaurar, suba a stack:
#   PULL=0 bash infra/scripts/deploy-prod.sh
# ==============================================================================
set -euo pipefail

BK="${1:?Uso: restore-volumes.sh <arquivo-de-backup.tar.gz>}"
[[ -f "$BK" ]] || { echo "Arquivo nao encontrado: $BK"; exit 1; }

VOLROOT="${VOLROOT:-/var/lib/docker/volumes}"
REPO="${REPO:-/opt/yugo-platform}"

command -v docker >/dev/null || { echo "Docker nao instalado."; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> Extraindo backup..."
tar -C "$WORK" -xzf "$BK"
DIR="$(find "$WORK" -maxdepth 1 -type d -name 'yugo-backup-*' | head -1)"
[[ -d "$DIR" ]] || DIR="$WORK"

VOLS=(
  yugo-postgres-data yugo-minio-data yugo-evolution-instances
  yugo-redis-data yugo-glpi-db-data yugo-glpi-data yugo-chatwoot-storage
)

for vol in "${VOLS[@]}"; do
  f="$DIR/$vol.tar.gz"
  [[ -f "$f" ]] || { echo "    (sem $vol no backup, pulando)"; continue; }
  echo "==> Restaurando $vol ..."
  docker volume create "$vol" >/dev/null
  dst="$VOLROOT/$vol/_data"
  mkdir -p "$dst"
  # limpa o destino antes (volume recem-criado vem vazio, mas garante)
  find "$dst" -mindepth 1 -delete 2>/dev/null || true
  tar -C "$dst" --numeric-owner -xzpf "$f"
done

# .env.production
if [[ -f "$DIR/.env.production" ]]; then
  mkdir -p "$REPO/infra/docker"
  cp "$DIR/.env.production" "$REPO/infra/docker/.env.production"
  echo "==> .env.production restaurado em $REPO/infra/docker/"
else
  echo "[ATENCAO] .env.production nao estava no backup — copie manualmente!"
fi

echo
echo "================================================================"
echo " RESTORE CONCLUIDO."
echo " Agora suba a stack na VPS nova:"
echo "   cd $REPO && PULL=0 bash infra/scripts/deploy-prod.sh"
echo "================================================================"
