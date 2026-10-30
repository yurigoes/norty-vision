# shellcheck shell=bash
# ==============================================================================
# lib-maquina.sh — confere em QUAL máquina o script está rodando.
#
# Não é executável: é `source`ado pelos scripts que mexem na produção.
#
# ------------------------------------------------------------------------------
# POR QUE ISTO EXISTE
#
# A produção do Norty Vision roda na **tyr**. A **thor** é o FAILOVER da tyr.
#
# E os scripts se chamam `*-nv-thor.sh`, os docs dizem "roda dentro da thor" e
# o roteiro de ACL do Tailscale libera `tag:thor:22`. Ou seja: todo nome
# aponta para a máquina ERRADA — a de reserva.
#
# O risco é concreto porque um failover é, por desenho, parecido com o
# original: `pct` existe, o CT 105 existe, o bind-mount `/opt/fase3` existe, o
# `shared-postgres` responde. TODAS as conferências que esses scripts já fazem
# passariam na máquina de reserva. Só o NOME distingue.
#
# Aplicar migration ou subir código na reserva é mexer numa cópia: a produção
# segue como estava, e você fica achando que subiu.
#
# ------------------------------------------------------------------------------
# E DEPOIS DE UM FAILOVER DE VERDADE?
#
# Aí a produção É a thor, e aplicar lá é o certo. Por isso isto não é uma
# tranca: é uma pergunta. Passe a máquina esperada e segue:
#
#     MAQUINA_PRODUCAO=thor bash infra/scripts/db-apply-nv-thor.sh
#
# Vale para qualquer nome, caso a máquina mude de novo.
# ==============================================================================

# Nome curto da máquina que hospeda a produção hoje.
MAQUINA_PRODUCAO="${MAQUINA_PRODUCAO:-tyr}"

confere_maquina() {
  local aqui
  aqui=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "")

  if [[ -z "$aqui" ]]; then
    printf '\033[33m[!]\033[0m não consegui ler o nome desta máquina — seguindo sem conferir.\n' >&2
    return 0
  fi

  if [[ "$aqui" == "$MAQUINA_PRODUCAO" ]]; then
    printf '\033[32m[OK]\033[0m máquina: %s (a produção)\n' "$aqui"
    return 0
  fi

  printf '\n\033[31m[ERRO]\033[0m esta máquina se chama \033[1m%s\033[0m, e a produção é a \033[1m%s\033[0m.\n\n' \
    "$aqui" "$MAQUINA_PRODUCAO" >&2
  cat >&2 <<TXT
  A thor é o FAILOVER da tyr. Um failover se parece com o original — pct, CT
  105, /opt/fase3, shared-postgres, tudo existe lá também — então nenhuma das
  outras conferências deste script notaria a diferença. Aplicar aqui mexe numa
  cópia, e a produção segue como estava.

  Se a produção REALMENTE é esta máquina agora (depois de um failover, ou
  porque ela mudou de nome), diga isso explicitamente:

      MAQUINA_PRODUCAO=$aqui bash $0

TXT
  exit 1
}
