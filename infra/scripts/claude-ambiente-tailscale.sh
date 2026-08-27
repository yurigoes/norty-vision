#!/usr/bin/env bash
# ==============================================================================
# claude-ambiente-tailscale.sh — põe o ambiente do Claude Code na web dentro do
# tailnet, pra ele conseguir falar com a thor.
#
# NÃO roda na VPS. Roda no container efêmero do Claude Code na web, como script
# de setup do ambiente (Settings → Environments → setup script).
#
# ------------------------------------------------------------------------------
# O QUE ELE PRECISA QUE JÁ EXISTA (três coisas, todas suas):
#
#   1. TS_AUTHKEY na configuração do ambiente — chave de autenticação do tailnet.
#      Gere em https://login.tailscale.com/admin/settings/keys como:
#         · Ephemeral    → o nó some sozinho quando o container morre. Sem isso
#                          cada sessão deixa um fantasma na lista de máquinas.
#         · Pre-approved → senão o nó fica esperando alguém aprovar na mão.
#         · Tagged       → `tag:claude-code`, pra ACL conseguir falar dele.
#         · Reusable     → cada sessão é um container novo.
#
#   2. pkgs.tailscale.com liberado na política de rede do ambiente. Hoje o proxy
#      de saída responde 403 nesse host, e o instalador não baixa.
#
#   3. Uma ACL no tailnet que deixe `tag:claude-code` alcançar SÓ a thor, e só na
#      porta que interessa. O nó não precisa do tailnet inteiro:
#
#        {
#          "action": "accept",
#          "src":    ["tag:claude-code"],
#          "dst":    ["tag:thor:22"]
#        }
#
# ------------------------------------------------------------------------------
# MODO USERSPACE, de propósito
#
# O container tem /dev/net/tun, mas pode não ter CAP_NET_ADMIN — e depender
# disso quebra sem aviso quando a imagem muda. Userspace networking não precisa
# de capability nenhuma: o tailscaled sobe um SOCKS5 local e o ssh sai por ele.
# Mais lento, e não importa: o que vai passar por aqui é um ssh de deploy.
# ==============================================================================
set -euo pipefail

readonly PORTA_SOCKS="${TS_SOCKS_PORT:-1055}"
readonly ESTADO="${TS_STATE_DIR:-/var/lib/tailscale}"
readonly NOME_DO_NO="${TS_HOSTNAME:-claude-code-norty}"

log()  { printf '[tailscale] %s\n' "$*"; }
die()  { printf '[tailscale][ERRO] %s\n' "$*" >&2; exit 1; }

# --- 1. a chave precisa existir ANTES de qualquer outra coisa ----------------
# Falhar aqui, cedo e explicando, vale mais que falhar lá na frente com
# "backend not ready" — que é o que o tailscale diz quando falta a chave.
[[ -n "${TS_AUTHKEY:-}" ]] || die \
  "TS_AUTHKEY não está no ambiente. Gere uma chave efêmera, pré-aprovada e com
  tag em https://login.tailscale.com/admin/settings/keys e ponha na configuração
  do ambiente. Sem ela não há como entrar no tailnet."

# --- 2. instalar (idempotente) ----------------------------------------------
if command -v tailscale >/dev/null 2>&1 && command -v tailscaled >/dev/null 2>&1; then
  log "já instalado: $(tailscale version | head -1)"
else
  log "instalando..."
  # O instalador oficial baixa de pkgs.tailscale.com. Se a política de rede do
  # ambiente não liberar esse host, o curl volta 403 no CONNECT e para aqui.
  if ! curl -fsSL --max-time 120 https://tailscale.com/install.sh | sh; then
    die "não consegui instalar. Se o erro foi 403 no CONNECT, o host
  pkgs.tailscale.com está bloqueado pela política de rede deste ambiente —
  libere o host na configuração do ambiente. Não dá pra contornar por fora."
  fi
fi

# --- 3. subir o daemon em userspace -----------------------------------------
mkdir -p "$ESTADO"
if tailscale status >/dev/null 2>&1; then
  log "daemon já de pé."
else
  log "subindo o tailscaled (userspace, SOCKS5 em localhost:${PORTA_SOCKS})..."
  tailscaled \
    --tun=userspace-networking \
    --socks5-server="localhost:${PORTA_SOCKS}" \
    --outbound-http-proxy-listen="localhost:${PORTA_SOCKS}" \
    --state="${ESTADO}/tailscaled.state" \
    >/var/log/tailscaled.log 2>&1 &

  # espera o socket em vez de dormir um número mágico
  for _ in $(seq 1 30); do
    tailscale status >/dev/null 2>&1 && break
    sleep 1
  done
fi

# --- 4. entrar no tailnet ----------------------------------------------------
log "entrando no tailnet como '${NOME_DO_NO}'..."
tailscale up \
  --authkey="${TS_AUTHKEY}" \
  --hostname="${NOME_DO_NO}" \
  --accept-routes \
  --ssh=false          # este nó CHAMA; ninguém precisa entrar nele

# --- 5. provar que alcança ---------------------------------------------------
log "estado do tailnet:"
tailscale status | sed 's/^/    /'

ALVO="${THOR_HOST:-thor}"
if tailscale status --json | grep -q "\"${ALVO}\""; then
  log "a ${ALVO} aparece no tailnet."
else
  log "AVISO: '${ALVO}' não aparece na lista acima. Confira o nome da máquina no
  admin do Tailscale e a ACL de tag:claude-code."
fi

cat <<FIM

[tailscale] pronto. Como sair por aqui:

  # ssh através do SOCKS5 (userspace não tem rota de kernel)
  ssh -o ProxyCommand='nc -X 5 -x localhost:${PORTA_SOCKS} %h %p' deploy@${ALVO}

  # ou, se a ACL do tailnet permitir Tailscale SSH (dispensa chave):
  tailscale ssh deploy@${ALVO}

FIM
