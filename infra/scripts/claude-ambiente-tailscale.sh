#!/usr/bin/env bash
# ==============================================================================
# claude-ambiente-tailscale.sh — INSTALA o tailscale no ambiente do Claude Code
# na web. Só instala; quem liga é o claude-sessao-tailscale.sh.
#
# NÃO roda na VPS. Vai no campo "Setup script" do ambiente
# (claude.ai/code → ícone de nuvem → engrenagem do ambiente).
#
# ------------------------------------------------------------------------------
# POR QUE INSTALAR E LIGAR SÃO DOIS SCRIPTS
#
# O setup script roda UMA VEZ e o ambiente vira um snapshot de disco, reusado
# pelas sessões seguintes. O snapshot guarda o que foi ESCRITO em disco e perde
# o que estava só RODANDO. Então:
#
#   instalar o binário   → disco  → sobrevive no cache  → aqui
#   subir o tailscaled   → processo → morre com o snapshot → hook de sessão
#
# Ligar o daemon aqui daria certo na primeira sessão e falharia calado em todas
# as outras — o pior tipo de erro.
#
# ------------------------------------------------------------------------------
# SAI SEMPRE COM ZERO, DE PROPÓSITO
#
# Setup script que sai diferente de zero faz a SESSÃO INTEIRA não subir. Não
# conseguir instalar o tailscale não pode impedir de trabalhar no repositório —
# então todo caminho de erro aqui avisa e devolve 0.
#
# ------------------------------------------------------------------------------
# O QUE PRECISA ESTAR LIBERADO NA POLÍTICA DE REDE DO AMBIENTE
#
# Network access = Custom, com "Also include default list of common package
# managers" marcado, e em "Allowed domains":
#
#     tailscale.com
#     *.tailscale.com
#
# O segundo não é enfeite: o instalador está em pkgs.tailscale.com, a
# coordenação em controlplane.tailscale.com e os relays em derpN.tailscale.com.
# Liberar só `tailscale.com` instala e não conecta.
# ==============================================================================
set -uo pipefail   # sem -e: erro aqui vira aviso, não sessão morta

log() { printf '[tailscale/setup] %s\n' "$*"; }

if command -v tailscaled >/dev/null 2>&1; then
  log "já instalado: $(tailscale version 2>/dev/null | head -1)"
  exit 0
fi

log "instalando..."
if curl -fsSL --max-time 120 https://tailscale.com/install.sh | sh; then
  log "instalado: $(tailscale version 2>/dev/null | head -1)"
else
  log "AVISO: não consegui instalar."
  log "  Se o erro foi 403 no CONNECT, a política de rede deste ambiente está"
  log "  bloqueando o host. Ponha Network access = Custom e adicione"
  log "  'tailscale.com' e '*.tailscale.com' em Allowed domains."
  log "  A sessão segue normalmente — só não vai alcançar a thor."
fi

exit 0
