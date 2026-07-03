#!/usr/bin/env bash
# ==============================================================================
# backup-hot.sh — backup A QUENTE (sem parar containers). Feito pra cron diario.
#
#   - Postgres: pg_dumpall (dump logico consistente de TODOS os bancos)
#   - MinIO:    tar do volume (objetos sao arquivos)
#   - Evolution: tar do volume (sessao do WhatsApp)
#   - .env.production
#
# Gera /opt/yugo-backups/yugo-hot-<ts>.tar.gz e mantem os ultimos KEEP (7).
# Se RCLONE_REMOTE estiver setado, envia o tarball pra nuvem (offsite) — ESSENCIAL:
# backup na mesma maquina nao protege contra perda da maquina.
#
# RESTORE (resumo):
#   tar -xzf yugo-hot-XXXX.tar.gz
#   zcat postgres-all.sql.gz | docker exec -i yugo-postgres psql -U <POSTGRES_USER>
#   (minio/evolution: parar o container, tar -xzf no _data do volume, subir)
#
# Cron diario (3h da manha):
#   echo '0 3 * * * root RCLONE_REMOTE=meuremoto:yugo /opt/yugo-platform/infra/scripts/backup-hot.sh >> /var/log/yugo-backup.log 2>&1' | sudo tee /etc/cron.d/yugo-backup
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS=$(date +%Y%m%d-%H%M%S)
DEST="${BACKUP_DIR:-/opt/yugo-backups}"
KEEP="${KEEP:-7}"
ENV_FILE="${ENV_FILE:-/opt/yugo-platform/infra/docker/.env.production}"
VOLROOT="${VOLROOT:-/var/lib/docker/volumes}"

# credenciais do Google Drive (opcional): coloque num arquivo so-leitura e ele
# e carregado aqui. Veja infra/docker/.gdrive.env.example.
GDRIVE_ENV="${GDRIVE_ENV:-/opt/yugo-platform/infra/docker/.gdrive.env}"
# `set -a` exporta tudo que vier do .gdrive.env — necessário pra o `docker run
# -e GDRIVE_*` repassar as variáveis pro container (sem export elas não chegam).
# shellcheck disable=SC1090
if [[ -f "$GDRIVE_ENV" ]]; then set -a; source "$GDRIVE_ENV"; set +a; fi

mkdir -p "$DEST"
OUT="$DEST/yugo-hot-$TS"
mkdir -p "$OUT"

# --- Postgres (dump logico, sem downtime) ---
if docker ps --format '{{.Names}}' | grep -q '^yugo-postgres$'; then
  PG_USER=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  PG_USER=${PG_USER:-postgres}
  echo "==> pg_dumpall (user=$PG_USER)..."
  docker exec -i yugo-postgres pg_dumpall -U "$PG_USER" | gzip > "$OUT/postgres-all.sql.gz"
else
  echo "[ATENCAO] yugo-postgres nao esta rodando — pulando dump do banco!"
fi

# --- MinIO (arquivos enviados) ---
if [[ -d "$VOLROOT/yugo-minio-data/_data" ]]; then
  echo "==> MinIO..."
  tar -C "$VOLROOT/yugo-minio-data/_data" --numeric-owner -czf "$OUT/minio-data.tar.gz" .
fi

# --- Evolution (sessao WhatsApp) ---
if [[ -d "$VOLROOT/yugo-evolution-instances/_data" ]]; then
  echo "==> Evolution..."
  tar -C "$VOLROOT/yugo-evolution-instances/_data" --numeric-owner -czf "$OUT/evolution.tar.gz" .
fi

# --- segredos ---
[[ -f "$ENV_FILE" ]] && cp "$ENV_FILE" "$OUT/.env.production"

# --- tarball unico ---
FINAL="$OUT.tar.gz"
tar -C "$DEST" -czf "$FINAL" "$(basename "$OUT")"
rm -rf "$OUT"
echo "==> Backup local: $FINAL ($(du -h "$FINAL" | cut -f1))"

# --- rotaciona: mantem os ultimos KEEP ---
ls -1t "$DEST"/yugo-hot-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# --- OFFSITE: Google Drive (uploader proprio, retencao GDRIVE_KEEP) ---
if [[ -n "${GDRIVE_REFRESH_TOKEN:-}" ]]; then
  echo "==> Enviando pro Google Drive (mantem ${GDRIVE_KEEP:-4} na nuvem)..."
  docker run --rm \
    -v "$FINAL":/backup.tar.gz:ro \
    -v "$SCRIPT_DIR/gdrive-upload.mjs":/up.mjs:ro \
    -e GDRIVE_CLIENT_ID -e GDRIVE_CLIENT_SECRET -e GDRIVE_REFRESH_TOKEN \
    -e GDRIVE_FOLDER_ID -e GDRIVE_KEEP \
    node:22-alpine node /up.mjs /backup.tar.gz \
    && echo "==> Google Drive OK." || echo "[ERRO] upload pro Drive falhou (veja acima)."
fi

# --- OFFSITE alternativo: rclone (mais robusto pra Google Drive) ---
# Retenção por CONTAGEM: mantém os últimos CLOUD_KEEP na nuvem (default 15).
# Nomes yugo-hot-YYYYMMDD-HHMMSS.tar.gz → ordem lexical = cronológica.
if [[ -n "${RCLONE_REMOTE:-}" ]] && command -v rclone >/dev/null; then
  CLOUD_KEEP="${CLOUD_KEEP:-${GDRIVE_KEEP:-15}}"
  echo "==> Enviando offsite via rclone ($RCLONE_REMOTE)..."
  if rclone copy "$FINAL" "$RCLONE_REMOTE"; then
    echo "==> rclone OK. Retenção: mantém $CLOUD_KEEP na nuvem."
    # SEGURANÇA: --files-only (nunca lista/apaga diretórios) + filtro estrito do
    # nome do backup. Sem isso, num remote apontado pra raiz do Drive a limpeza
    # tentaria apagar pastas do usuário.
    mapfile -t _old < <(rclone lsf "$RCLONE_REMOTE" --files-only --include 'yugo-hot-*.tar.gz' 2>/dev/null | sort | head -n -"$CLOUD_KEEP")
    for f in "${_old[@]}"; do [[ "$f" == yugo-hot-*.tar.gz ]] && rclone deletefile "$RCLONE_REMOTE/$f" && echo "   apagado da nuvem: $f"; done
  else
    echo "[ERRO] upload via rclone falhou."
  fi
fi

if [[ -z "${GDRIVE_REFRESH_TOKEN:-}" && -z "${RCLONE_REMOTE:-}" ]]; then
  echo "[DICA] Sem destino offsite. Configure o Google Drive (.gdrive.env) ou RCLONE_REMOTE."
fi
