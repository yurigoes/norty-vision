#!/usr/bin/env bash
# ==============================================================================
# subir-vision.sh — sobe o Norty Vision na ORDEM CERTA: banco primeiro, código
# depois. Roda na **tyr**, como root — a thor é o FAILOVER da tyr, e os dois
# scripts que este chama barram a execução na máquina errada (lib-maquina.sh).
# Depois de um failover de verdade, a produção É a thor, e aí:
#
#     MAQUINA_PRODUCAO=thor bash /root/subir-vision.sh
#
# Faz nesta ordem, e para no primeiro problema:
#
#   1. atualiza o CLONE (.norty-vision-src) para a branch certa
#      — isto é o que o deploy NÃO faz: ele usa `git archive origin/<ref>` e
#        deixa o diretório de trabalho do clone onde estava. Como o
#        db-apply lê os .sql do diretório de trabalho, sem este passo ele
#        aplicaria o SQL ANTIGO (sem as migrations 215/216/217).
#   2. ensaio do banco      (db-apply-nv-thor.sh --dry-run)
#   3. ensaio do código     (deploy-nv-thor.sh --dry-run)
#   4. pede confirmação UMA vez
#   5. aplica o banco       (com dump antes, feito pelo próprio db-apply)
#   6. sobe o código        (com REF=, que não é opcional)
#
# Uso:
#   bash /root/subir-vision.sh                 # ensaio + confirmação + sobe
#   SO_ENSAIO=1 bash /root/subir-vision.sh     # só os dois ensaios, não aplica
#   SIM=1 bash /root/subir-vision.sh           # sem perguntar (sei o que faço)
# ==============================================================================
set -euo pipefail

REF="${REF:-claude/vision-navigation-ux-o68691}"
CT_APP="${CT_APP:-105}"

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s======>%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()    { printf '%s[OK]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso() { printf '%s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre() { printf '\n%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)."
command -v pct >/dev/null || morre "sem \`pct\` — este script roda NA THOR, não dentro do CT."

# --- onde o código mora neste host (o mesmo jeito dos outros dois scripts) ---
BASE="${BASE:-$(pct config "$CT_APP" 2>/dev/null | sed -n 's|^mp[0-9]*: \([^,]*\),mp=/opt/fase3$|\1|p' | head -1)}"
[[ -n "$BASE" ]] || morre "não descobri o caminho do código. Veja \`pct config $CT_APP | grep ^mp\`
  e rode de novo com  BASE=/caminho/apps-fase3 bash $0"
FONTE="$BASE/.norty-vision-src"
[[ -d "$FONTE/.git" ]] || morre "$FONTE não é um clone git. Esta é a máquina certa?"
ok "clone em $FONTE"

# --- 1. o clone tem que estar NA BRANCH e ATUALIZADO ------------------------
# Se alguém deixou alteração solta aqui, parar é melhor que sobrescrever: este
# clone é a origem do que vai pra produção.
SUJO=$(git -C "$FONTE" status --porcelain)
[[ -z "$SUJO" ]] || morre "o clone tem alteração não comitada — não vou sobrescrever:
$SUJO
  Resolva em $FONTE (git stash, ou git checkout -- .) e rode de novo."

log "atualizando o clone para $REF"
for t in 1 2 4 8 16; do
  git -C "$FONTE" fetch --prune origin "$REF" && break
  aviso "fetch falhou; nova tentativa em ${t}s"; sleep "$t"
done
git -C "$FONTE" checkout -B "$REF" "origin/$REF"
ok "clone em: $(git -C "$FONTE" log -1 --format='%h %ad %s' --date=short)"

cd "$FONTE"
[[ -f infra/scripts/db-apply-nv-thor.sh ]] || morre "não achei db-apply-nv-thor.sh no clone atualizado."
[[ -f infra/scripts/deploy-nv-thor.sh  ]] || morre "não achei deploy-nv-thor.sh no clone atualizado."

# --- 2 e 3. os dois ensaios --------------------------------------------------
log "ENSAIO DO BANCO — nada é aplicado"
bash infra/scripts/db-apply-nv-thor.sh --dry-run

log "ENSAIO DO CÓDIGO — nada é alterado"
REF="$REF" bash infra/scripts/deploy-nv-thor.sh --dry-run

if [[ "${SO_ENSAIO:-0}" == "1" ]]; then
  log "SO_ENSAIO=1 — paro aqui. Nada foi aplicado."
  exit 0
fi

# --- 4. confirmação ----------------------------------------------------------
if [[ "${SIM:-0}" != "1" ]]; then
  printf '\n%s' "$C_AV"
  cat <<'TXT'
Os dois ensaios passaram. O que vem agora MEXE NA PRODUÇÃO:

  · as migrations da 198 em diante no banco norty_vision (com dump antes)
  · rebuild e restart do nv-api e do nv-web

TXT
  printf '%s' "$C_0"
  read -r -p "Subir? digite  subir  e Enter (qualquer outra coisa aborta): " resposta
  [[ "$resposta" == "subir" ]] || { aviso "abortado por você. Nada foi alterado."; exit 1; }
fi

# --- 5. banco ----------------------------------------------------------------
log "APLICANDO AS MIGRATIONS"
bash infra/scripts/db-apply-nv-thor.sh

# --- 6. código ---------------------------------------------------------------
log "SUBINDO O CÓDIGO ($REF)"
REF="$REF" bash infra/scripts/deploy-nv-thor.sh

log "pronto"
cat <<TXT

O deploy já espera o nv-api e o nv-web ficarem saudáveis — se ele disse
"saudáveis", o serviço está no ar. O que falta é da tela:

  1. https://vision.norty.com.br  → entrar e abrir Relatórios:
     os campos de data e os atalhos (30 dias / este mês / mês passado / este
     ano), e a tabela de mais vendidos com as colunas PDV e Pedido de lente.
     É aí que sai a resposta da Zito: quantas armações em setembro.
  2. /app/ponto → o terminal tem que bater ponto. É o teste que importa:
     foi GRANT faltando que derrubou isso em outubro, e o db-apply agora
     reaplica os GRANTs e confere tabela por tabela antes de deixar subir.
  3. /app/ponto → Espelho de um funcionário, e conferir se soma igual.

Se algo não ficar saudável, os logs:
  pct exec $CT_APP -- docker logs --tail 80 nv-api
  pct exec $CT_APP -- docker logs --tail 80 nv-web
TXT
