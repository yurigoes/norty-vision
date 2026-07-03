#!/usr/bin/env bash
# ==============================================================================
# backup-volumes.sh — empacota os dados da plataforma pra migrar de VPS.
#
# Roda na VPS ANTIGA. Copia os volumes Docker (Postgres, MinIO, etc) e o
# .env.production num tarball unico que voce leva pra VPS nova.
#
# IMPORTANTE: para uma copia CONSISTENTE do Postgres, os containers sao parados
# antes da copia (uma copia "a quente" do PGDATA pode corromper). Como aqui nada
# precisa estar no ar pro backup, isso e seguro.
#
# Uso:   bash infra/scripts/backup-volumes.sh
# Saida: /opt/yugo-backup-<timestamp>.tar.gz
# ==============================================================================
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
OUT="${OUT:-/opt/yugo-backup-$TS}"
VOLROOT="${VOLROOT:-/var/lib/docker/volumes}"
ENV_FILE="${ENV_FILE:-/opt/yugo-platform/infra/docker/.env.production}"

# volumes a salvar (os inexistentes sao pulados)
VOLS=(
  yugo-postgres-data        # CRITICO: app + chatwoot DB
  yugo-minio-data           # CRITICO: arquivos enviados (docs/fotos/contratos/NF)
  yugo-evolution-instances  # sessao do WhatsApp (evita reparear)
  yugo-redis-data           # filas/cache (opcional)
  yugo-glpi-db-data         # GLPI (opcional)
  yugo-glpi-data            # GLPI (opcional)
  yugo-chatwoot-storage     # Chatwoot arquivos (opcional)
)

echo "==> Backup em: $OUT"
mkdir -p "$OUT"

# para os containers pra copia consistente (se houver algum no ar)
running=$(docker ps -q 2>/dev/null || true)
if [[ -n "$running" ]]; then
  echo "==> Parando containers para copia consistente..."
  docker stop $running >/dev/null
fi

for vol in "${VOLS[@]}"; do
  src="$VOLROOT/$vol/_data"
  if [[ -d "$src" ]]; then
    echo "==> Empacotando $vol ..."
    tar -C "$src" --numeric-owner -czpf "$OUT/$vol.tar.gz" . 2>/dev/null || \
      tar -C "$src" --numeric-owner -czf "$OUT/$vol.tar.gz" .
  else
    echo "    (pulando $vol — nao existe)"
  fi
done

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$OUT/.env.production"
  echo "==> .env.production incluido."
else
  echo "[ATENCAO] $ENV_FILE nao encontrado — copie manualmente!"
fi

# tarball unico
FINAL="$OUT.tar.gz"
tar -C "$(dirname "$OUT")" -czf "$FINAL" "$(basename "$OUT")"
rm -rf "$OUT"

echo
echo "================================================================"
echo " BACKUP PRONTO: $FINAL"
echo " Tamanho: $(du -h "$FINAL" | cut -f1)"
echo
echo " Copie esse arquivo pra VPS nova, por exemplo:"
echo "   scp $FINAL root@NOVA_VPS:/opt/"
echo "================================================================"
