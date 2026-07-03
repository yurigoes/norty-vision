#!/usr/bin/env bash
# ==============================================================================
# ensure-swap.sh — garante swap na VPS pra o build não derrubar a máquina (OOM).
#
# O build do web (next build) + api (nest/tsc/prisma) é faminto de RAM. Em VPS
# pequena, sem swap, o kernel mata processos ou REINICIA a máquina no meio do
# deploy. Este script cria um swapfile persistente se ainda não houver swap.
#
# Uso:  sudo bash infra/scripts/ensure-swap.sh [TAMANHO_GB]   (padrão 4)
# Idempotente: se já existe swap, não faz nada.
# ==============================================================================
set -euo pipefail

SIZE_GB="${1:-4}"
SWAPFILE="/swapfile"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Precisa de root. Rode: sudo bash infra/scripts/ensure-swap.sh ${SIZE_GB}"
  exit 1
fi

# já tem algum swap ativo? então não mexe.
if [[ -n "$(swapon --show --noheadings 2>/dev/null)" ]]; then
  echo "[OK] Swap já ativo:"
  swapon --show
  exit 0
fi

echo "==> Sem swap. Criando swapfile de ${SIZE_GB}G em ${SWAPFILE}..."
if [[ -e "$SWAPFILE" ]]; then
  swapoff "$SWAPFILE" 2>/dev/null || true
  rm -f "$SWAPFILE"
fi

# fallocate é instantâneo; se falhar (alguns FS), cai pro dd.
if ! fallocate -l "${SIZE_GB}G" "$SWAPFILE" 2>/dev/null; then
  dd if=/dev/zero of="$SWAPFILE" bs=1M count="$((SIZE_GB * 1024))" status=progress
fi
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

# persiste no /etc/fstab
if ! grep -qE "^\s*${SWAPFILE}\s" /etc/fstab; then
  echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  echo "==> Entrada adicionada ao /etc/fstab (persiste no boot)."
fi

# swappiness moderado (10) pra usar RAM e só apelar pro swap sob pressão
sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
if ! grep -qE "^\s*vm.swappiness" /etc/sysctl.d/99-swappiness.conf 2>/dev/null; then
  echo "vm.swappiness=10" > /etc/sysctl.d/99-swappiness.conf
fi

echo "[OK] Swap ativo:"
swapon --show
free -h
