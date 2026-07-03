#!/usr/bin/env bash
# ==============================================================================
# install.sh — instalador GUIADO de primeira instalação do yugo-platform.
#
# Pergunta o essencial, grava no .env e roda tudo NA ORDEM CERTA:
#   1. Docker (instala se faltar)
#   2. generate-secrets.sh  (segredos aleatórios + placeholders)
#   3. coleta DOMAIN / CLOUDFLARED_TOKEN / RUNBOOK_PASSWORD e o que ligar
#   4. deploy-prod.sh  (postgres -> migrations -> api/web; tunnel; evolution)
#   5. bootstrap-evolution.sh  (se Evolution ligado)
#   6. create-master.sh  (primeiro login master)
#   7. (opcional) agenda backup diário no cron
#
# Pré-requisito: repo já clonado (você está rodando este script de dentro dele).
#
#   bash infra/scripts/install.sh
# ==============================================================================
set -euo pipefail

C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_BLUE=$'\033[34m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
log()  { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '%s[ERR]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
ask()  { local p="$1" d="${2:-}" r; if [[ -n "$d" ]]; then read -rp "$p [$d]: " r; echo "${r:-$d}"; else read -rp "$p: " r; echo "$r"; fi; }
yesno(){ local p="$1" d="${2:-s}" r; read -rp "$p ($([[ $d == s ]] && echo 'S/n' || echo 's/N')): " r; r="${r:-$d}"; [[ "$r" =~ ^[sSyY] ]]; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"

# grava chave=valor no .env sem sed (lida com / + = no valor, ex. token CF)
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  [[ -f "$ENV_FILE" ]] && grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

echo "============================================================"
echo "  Instalador yugo-platform — primeira instalação guiada"
echo "============================================================"

# --- 1. Docker -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  if yesno "Docker não encontrado. Instalar agora?"; then
    log "Instalando Docker..."; curl -fsSL https://get.docker.com | sh
  else
    die "Docker é necessário."
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 ausente."
ok "Docker pronto."

# --- 2. segredos -----------------------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  if yesno "Já existe .env.production. REGERAR os segredos (apaga senhas atuais)?" n; then
    bash "$SCRIPT_DIR/generate-secrets.sh" --force
  else
    log "Mantendo .env.production atual."
  fi
else
  bash "$SCRIPT_DIR/generate-secrets.sh"
fi

# --- 3. valores manuais ----------------------------------------------------
echo; log "Configuração:"
DOMAIN_IN="$(ask 'Domínio principal' 'yugochat.com.br')"
set_env DOMAIN "$DOMAIN_IN"
set_env TUNNEL_BASE_DOMAIN "$DOMAIN_IN"
set_env PLATFORM_ORG_SLUG "$(ask 'Slug da empresa dona do SaaS (apex)' 'yugo')"

echo
echo "Token do Cloudflare Tunnel (Cloudflare > Zero Trust > Tunnels > seu túnel"
echo "> Add a connector > a string longa depois de --token, começa com eyJ...)."
CFTOK="$(ask 'CLOUDFLARED_TOKEN (Enter pra pular o túnel)')"
[[ -n "$CFTOK" ]] && set_env CLOUDFLARED_TOKEN "$CFTOK" || warn "Sem token — o site não fica acessível pelo domínio até preencher."

RB="$(ask 'Senha da página Runbook (Enter mantém a gerada)')"
[[ -n "$RB" ]] && set_env RUNBOOK_PASSWORD "$RB"

# --- 4. quais serviços ligar ----------------------------------------------
echo
if yesno "Rodar Chatwoot + GLPI? (PESADOS — precisa 8GB+ de RAM)" n; then
  ok "Chatwoot/GLPI: LIGADOS (mantendo senhas geradas)."
else
  set_env CHATWOOT_DB_PASSWORD ""
  set_env GLPI_DB_PASSWORD ""
  set_env GLPI_DB_ROOT_PASSWORD ""
  ok "Chatwoot/GLPI: desligados (usar o helpdesk próprio /app/chamados)."
fi

EVO_ON=1
if yesno "Rodar Evolution (WhatsApp)?" s; then
  ok "Evolution: LIGADO."
else
  set_env EVOLUTION_API_KEY ""
  EVO_ON=0
  warn "Evolution: desligado (sem WhatsApp)."
fi

# --- 5. deploy -------------------------------------------------------------
echo; log "Subindo a stack (build + migrations + serviços)... pode demorar."
bash "$SCRIPT_DIR/deploy-prod.sh" --no-pull

# --- 6. evolution db -------------------------------------------------------
if [[ "$EVO_ON" == "1" ]]; then
  log "Preparando banco do Evolution..."
  bash "$SCRIPT_DIR/bootstrap-evolution.sh"
  docker restart yugo-evolution >/dev/null 2>&1 || true
  ok "Evolution reiniciado."
fi

# --- 7. master -------------------------------------------------------------
echo
if yesno "Criar o usuário master agora?"; then
  bash "$SCRIPT_DIR/create-master.sh"
fi

# --- 8. backup (opcional) --------------------------------------------------
echo
if yesno "Agendar backup diário automático (3h da manhã)?"; then
  echo "0 3 * * * root $REPO_DIR/infra/scripts/backup-hot.sh >> /var/log/yugo-backup.log 2>&1" | sudo tee /etc/cron.d/yugo-backup >/dev/null
  ok "Cron criado. Configure o Google Drive em infra/docker/.gdrive.env (veja a página Suporte > Recuperação & Backup)."
fi

echo
echo "============================================================"
ok  "Instalação concluída."
echo "  Site:   https://$DOMAIN_IN"
echo "  Status: docker ps"
echo "  Logs:   docker logs -f yugo-api"
echo "============================================================"
