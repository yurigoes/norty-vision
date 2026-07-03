#!/usr/bin/env bash
# ==============================================================================
# cron-install.sh — agenda a atualização mensal da base CNPJ (load-cnpj.sh) no
# crontab do usuário atual. Idempotente (não duplica a linha).
#
# Uso:
#   bash infra/scripts/cron-install.sh                 # dia 15, 04:00, UF=BA
#   UF=BA CRON_SPEC="0 4 15 * *" bash infra/scripts/cron-install.sh
#   bash infra/scripts/cron-install.sh --remove        # remove o agendamento
#
# Roda o load-cnpj.sh e registra o log em $HOME/yugo-cnpj.log.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD="$REPO_DIR/infra/scripts/load-cnpj.sh"
UF="${UF:-BA}"
CRON_SPEC="${CRON_SPEC:-0 4 15 * *}"     # min hora dia mês dia-semana → dia 15, 04:00
LOG="$HOME/yugo-cnpj.log"
TAG="# yugo-cnpj-loader"                  # marcador p/ encontrar/atualizar a linha

[[ -f "$LOAD" ]] || { echo "Falta $LOAD"; exit 1; }

# remove qualquer linha antiga nossa (pelo marcador)
current="$(crontab -l 2>/dev/null | grep -v "$TAG" || true)"

if [[ "${1:-}" == "--remove" ]]; then
  printf '%s\n' "$current" | crontab -
  echo "Cron da base CNPJ removido."
  exit 0
fi

line="$CRON_SPEC cd $REPO_DIR && UF=$UF bash $LOAD >> $LOG 2>&1 $TAG"
{ printf '%s\n' "$current"; printf '%s\n' "$line"; } | sed '/^$/d' | crontab -

echo "Agendado: $CRON_SPEC  (UF=$UF)"
echo "Comando : cd $REPO_DIR && UF=$UF bash $LOAD >> $LOG 2>&1"
echo "Log     : $LOG"
echo
echo "Crontab atual:"
crontab -l | grep "$TAG" || true
