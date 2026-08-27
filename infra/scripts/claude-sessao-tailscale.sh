#!/usr/bin/env bash
# ==============================================================================
# claude-sessao-tailscale.sh — LIGA o tailscale a cada sessão do Claude Code.
#
# Chamado pelo hook SessionStart em .claude/settings.json. Não roda na VPS.
#
# Por que não no setup script: o ambiente vira um snapshot de DISCO reusado
# pelas sessões seguintes, e processo não entra em snapshot. O binário sobrevive
# (instalado pelo setup); o daemon precisa subir toda sessão.
#
# É inofensivo fora do lugar: sem tailscale instalado ou sem TS_AUTHKEY, avisa e
# sai com zero. Rodar isso na sua máquina não faz nada.
#
# ------------------------------------------------------------------------------
# MODO USERSPACE, de propósito
#
# O container tem /dev/net/tun mas pode não ter CAP_NET_ADMIN — e depender disso
# quebra sem aviso quando a imagem muda. Userspace networking não precisa de
# capability nenhuma: o tailscaled abre um SOCKS5 local e o ssh sai por ele.
# Mais lento, e não importa: o que passa por aqui é um ssh de deploy.
#
# A saída do container é só HTTPS por proxy — não há UDP pra conexão direta.
# O tailscale cai no relay (DERP) sobre 443, que é justamente o caminho que
# funciona aqui. Por isso o `*.tailscale.com` na lista de domínios liberados.
# ==============================================================================
set -uo pipefail

PORTA_SOCKS="${TS_SOCKS_PORT:-1055}"
ESTADO="${TS_STATE_DIR:-/var/lib/tailscale}"
NOME_DO_NO="${TS_HOSTNAME:-claude-code-norty}"
ALVO="${THOR_HOST:-thor}"

log() { printf '[tailscale/sessao] %s\n' "$*"; }

command -v tailscaled >/dev/null 2>&1 || {
  log "tailscale não está instalado neste ambiente — seguindo sem ele."
  exit 0
}

[[ -n "${TS_AUTHKEY:-}" ]] || {
  log "TS_AUTHKEY não está no ambiente — seguindo sem tailnet."
  log "  (chave efêmera + pré-aprovada + com tag, em"
  log "   https://login.tailscale.com/admin/settings/keys)"
  exit 0
}

# --- daemon ------------------------------------------------------------------
#
# CUIDADO com o teste de "está de pé": `tailscale status` SAI COM 1 enquanto o
# nó não entrou no tailnet (estado NeedsLogin) — que é exatamente a situação em
# que estamos aqui. Usar ele pra esperar o daemon faz a espera nunca terminar,
# com o daemon já rodando do lado. `status --json` sai com 0 em qualquer estado
# e diz qual é o estado no BackendState; é esse que serve pra esperar.
estado() { tailscale status --json 2>/dev/null | sed -n 's/.*"BackendState": *"\([^"]*\)".*/\1/p' | head -1; }

if [[ -n "$(estado)" ]]; then
  log "daemon já de pé (estado: $(estado))."
else
  log "subindo o tailscaled (userspace, SOCKS5 em localhost:${PORTA_SOCKS})..."
  mkdir -p "$ESTADO"
  tailscaled \
    --tun=userspace-networking \
    --socks5-server="localhost:${PORTA_SOCKS}" \
    --outbound-http-proxy-listen="localhost:${PORTA_SOCKS}" \
    --state="${ESTADO}/tailscaled.state" \
    >/var/log/tailscaled.log 2>&1 &

  # espera o daemon responder, em vez de dormir um número mágico
  pronto=0
  for _ in $(seq 1 30); do
    if [[ -n "$(estado)" ]]; then pronto=1; break; fi
    sleep 1
  done
  [[ "$pronto" == "1" ]] || {
    log "AVISO: o daemon não respondeu em 30s. Veja /var/log/tailscaled.log."
    exit 0
  }
fi

# --- entrar no tailnet -------------------------------------------------------
if ! tailscale up \
      --authkey="${TS_AUTHKEY}" \
      --hostname="${NOME_DO_NO}" \
      --accept-routes \
      --ssh=false; then          # este nó CHAMA; ninguém precisa entrar nele
  log "AVISO: não entrei no tailnet. Chave vencida, ou a política de rede está"
  log "  bloqueando controlplane.tailscale.com / derpN.tailscale.com."
  log "  Libere 'tailscale.com' E '*.tailscale.com' em Allowed domains."
  exit 0
fi

# --- provar que alcança ------------------------------------------------------
if tailscale status 2>/dev/null | grep -qi "[[:space:]]${ALVO}[[:space:]]"; then
  log "no tailnet, e a ${ALVO} aparece. Pra sair por aqui:"
  log "  ssh -o ProxyCommand='nc -X 5 -x localhost:${PORTA_SOCKS} %h %p' deploy@${ALVO}"
else
  log "no tailnet, mas '${ALVO}' NÃO aparece na lista de máquinas."
  log "  Confira o nome no admin do Tailscale e a ACL de tag:claude-code."
fi

exit 0
