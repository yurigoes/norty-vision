#!/usr/bin/env bash
# ==============================================================================
# backup-cron-install.sh — agenda o backup-hot.sh para rodar TODO DIA (root).
#
# Cria /etc/cron.d/yugo-backup chamando o backup-hot.sh (pg_dumpall + MinIO +
# Evolution + .env), que já rotaciona local e envia pro Google Drive (offsite)
# com retenção própria. Idempotente: sobrescreve o arquivo de cron.
#
# Uso:
#   sudo bash infra/scripts/backup-cron-install.sh                  # 03:00, KEEP=15
#   sudo KEEP=15 CRON_SPEC="0 3 * * *" bash infra/scripts/backup-cron-install.sh
#   sudo bash infra/scripts/backup-cron-install.sh --remove
#
# Retenção:
#   KEEP        → backups mantidos LOCALMENTE (em $BACKUP_DIR). Padrão 15.
#   GDRIVE_KEEP → backups mantidos NA NUVEM (Google Drive). Vem do .gdrive.env;
#                 coloque GDRIVE_KEEP=15 lá pra casar com o pedido.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOT="$SCRIPT_DIR/backup-hot.sh"
CRON_SPEC="${CRON_SPEC:-0 3 * * *}"          # min hora dia mês dia-sem → 03:00 todo dia
KEEP="${KEEP:-15}"                            # backups locais mantidos
BACKUP_DIR="${BACKUP_DIR:-/opt/yugo-backups}"
CRONFILE="/etc/cron.d/yugo-backup"
LOG="${LOG:-/var/log/yugo-backup.log}"

[[ "$(id -u)" -eq 0 ]] || { echo "Precisa de root. Rode: sudo bash infra/scripts/backup-cron-install.sh"; exit 1; }

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$CRONFILE"
  echo "Cron de backup removido ($CRONFILE)."
  exit 0
fi

[[ -f "$HOT" ]] || { echo "Falta $HOT"; exit 1; }

# offsite via rclone (opcional): passe RCLONE_REMOTE=gdrive: na chamada e ele
# vai pro cron. O uploader OAuth (.gdrive.env) é detectado pelo próprio script.
RCLONE_PART=""
[[ -n "${RCLONE_REMOTE:-}" ]] && RCLONE_PART="RCLONE_REMOTE=$RCLONE_REMOTE "

cat > "$CRONFILE" <<CRON
# yugo — backup diário (gerado por backup-cron-install.sh). Não editar à mão.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$CRON_SPEC root BACKUP_DIR=$BACKUP_DIR KEEP=$KEEP ${RCLONE_PART}$HOT >> $LOG 2>&1
CRON
chmod 644 "$CRONFILE"

echo "Agendado: $CRON_SPEC"
echo "Script  : $HOT"
echo "Local   : mantém os últimos $KEEP em $BACKUP_DIR"
echo "Nuvem   : GDRIVE_KEEP vem do .gdrive.env (coloque 15 lá)"
echo "Log     : $LOG"
echo
echo "Testar agora (sem esperar o cron):"
echo "  sudo BACKUP_DIR=$BACKUP_DIR KEEP=$KEEP bash $HOT"
