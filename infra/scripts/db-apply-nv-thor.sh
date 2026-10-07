#!/usr/bin/env bash
# ==============================================================================
# db-apply-nv-thor.sh — aplica as migrations do Norty Vision no Postgres
# compartilhado da thor (CT 102 · Yggdrasil, banco `norty_vision`).
#
# RODA NA THOR, como root. Não confundir com:
#
#   infra/scripts/db-apply.sh         ← aponta pro Postgres DO COMPOSE e pro
#                                       .env.production. Nenhum dos dois existe
#                                       nesta instalação; não serve aqui.
#   /root/deploy-norty-vision.sh      ← NÃO É DEPLOY. É a migração única de
#                                       3/jul, com pg_restore --clean, que
#                                       APAGA o banco. Nunca rode.
#
# ------------------------------------------------------------------------------
# POR QUE ESTE SCRIPT EXISTE
#
# O `deploy-nv-thor.sh` sincroniza código e reconstrói os containers — e NÃO
# aplica migration nenhuma. Enquanto o schema acompanhava o código isso não
# aparecia. Com o ponto eletrônico em paridade com o RH, aparece: o Prisma
# Client passou a esperar 8 tabelas e dezenas de colunas que o banco de julho
# não tem.
#
# A ORDEM IMPORTA, e é o contrário da intuição:
#
#     1. aplicar as migrations   (este script)
#     2. subir o código          (deploy-nv-thor.sh)
#
# Subir o código antes quebra o ponto inteiro: toda consulta que tocar numa
# tabela nova estoura com "relation does not exist". Na ordem certa não há
# janela de quebra — as migrations só ADICIONAM tabelas e colunas, e o código
# velho ignora o que não conhece.
#
# ------------------------------------------------------------------------------
# USO
#
#   bash db-apply-nv-thor.sh --dry-run     # lista o que rodaria, sem tocar
#   bash db-apply-nv-thor.sh               # aplica da 198 em diante
#   DE=125 bash db-apply-nv-thor.sh        # a partir de outro número
#   TUDO=1 bash db-apply-nv-thor.sh        # todas (são idempotentes)
#   SEM_BACKUP=1 bash db-apply-nv-thor.sh  # pula o dump (não recomendado)
#
# Idempotente: os SQLs usam IF NOT EXISTS / CREATE OR REPLACE. Rodar duas vezes
# não tem efeito colateral — e rodar o conjunto todo é seguro por desenho.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
BANCO=${BANCO:-norty_vision}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}
FONTE=${FONTE:-/srv/apps-fase3/.norty-vision-src}
BACKUPS=${BACKUPS:-/srv/apps-fase3/.norty-vision-backups}
DE=${DE:-198}

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s==>%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()    { printf '%s[OK]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso() { printf '%s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre() { printf '%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)"
command -v pct >/dev/null || morre "sem \`pct\` — este script roda NA THOR, não dentro do CT"

SQL_DIR="$FONTE/packages/db/sql"
[[ -d "$SQL_DIR" ]] || morre "não achei $SQL_DIR. O clone está em $FONTE? (git clone do repositório)"

# --- psql dentro do CT, com a senha vinda do .env da infra compartilhada -----
# A senha NUNCA aparece na linha de comando: entra por variável de ambiente
# dentro do próprio CT, lida do .env que já está lá.
psql_ct() {
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -i -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $BANCO -v ON_ERROR_STOP=1 $*"
}

log "conferindo que o banco responde"
VIVO=$(psql_ct -tAc "'select 1'" 2>/dev/null | tr -d '[:space:]') || true
[[ "$VIVO" == "1" ]] || morre "não consegui falar com o banco $BANCO no $CONTAINER (CT $CT)."
ok "banco $BANCO respondendo"

# --- o que vai rodar ---------------------------------------------------------
if [[ "${TUDO:-0}" == "1" ]]; then
  ARQUIVOS=$(ls "$SQL_DIR"/*.sql | sort)
  log "TUDO=1 — todas as migrations (são idempotentes)"
else
  ARQUIVOS=$(ls "$SQL_DIR"/*.sql | sort | awk -v de="$DE" -F/ '{ n=$NF+0; if (n >= de) print }')
  log "migrations da $DE em diante"
fi
[[ -n "$ARQUIVOS" ]] || morre "nenhum arquivo selecionado (DE=$DE). Confira $SQL_DIR."
QUANTAS=$(echo "$ARQUIVOS" | wc -l)
echo "$ARQUIVOS" | xargs -n1 basename | sed 's/^/    /'
printf '  total: %s arquivo(s)\n' "$QUANTAS"

if [[ $DRY -eq 1 ]]; then
  log "--dry-run: nada foi aplicado."
  exit 0
fi

# --- backup ANTES de qualquer DDL -------------------------------------------
if [[ "${SEM_BACKUP:-0}" != "1" ]]; then
  CARIMBO=$(date +%Y%m%d-%H%M%S)
  DUMP="$BACKUPS/norty_vision-$CARIMBO.dump"
  mkdir -p "$BACKUPS"
  log "dump do banco antes de mexer (pode demorar)"
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    pg_dump -U postgres -d $BANCO -Fc -f /tmp/nv-pre-migration.dump"
  pct pull "$CT" /tmp/nv-pre-migration.dump "$DUMP"
  pct exec "$CT" -- rm -f /tmp/nv-pre-migration.dump
  ok "backup em $DUMP ($(du -h "$DUMP" | cut -f1))"
  echo "     restaurar:  pg_restore -U postgres -d $BANCO --clean --if-exists $DUMP"
else
  aviso "SEM_BACKUP=1 — seguindo sem dump. DDL em produção sem volta."
fi

# --- aplica, uma a uma, parando no primeiro erro ----------------------------
log "aplicando"
FEITAS=0
for f in $ARQUIVOS; do
  nome=$(basename "$f")
  # o SQL vai pro CT e de lá pro container; stdin através de duas camadas
  # (pct + docker) engole erro em silêncio, então é por arquivo mesmo.
  pct push "$CT" "$f" "/tmp/mig.sql"
  pct exec "$CT" -- bash -c "docker cp /tmp/mig.sql $CONTAINER:/tmp/mig.sql"
  if pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
      docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
      psql -U postgres -d $BANCO -v ON_ERROR_STOP=1 -q -f /tmp/mig.sql" 2>&1 | sed 's/^/      /'; then
    printf '  %s[ok]%s %s\n' "$C_OK" "$C_0" "$nome"
    FEITAS=$((FEITAS + 1))
  else
    pct exec "$CT" -- rm -f /tmp/mig.sql 2>/dev/null || true
    morre "falhou em $nome. As anteriores JÁ foram aplicadas (são idempotentes,
  então dá pra corrigir e rodar de novo). Se precisar voltar tudo, o dump está
  em ${DUMP:-'(não feito — SEM_BACKUP=1)'}."
  fi
  pct exec "$CT" -- rm -f /tmp/mig.sql 2>/dev/null || true
done
pct exec "$CT" -- bash -c "docker exec $CONTAINER rm -f /tmp/mig.sql" 2>/dev/null || true
ok "$FEITAS de $QUANTAS aplicadas"

# --- conferência: o banco tem o que o Prisma Client espera? ------------------
# Sem isto o script "passa" e o erro só aparece quando alguém abre o Ponto.
log "conferindo o que o código novo precisa"
FALTOU=0
confere_tabela() {
  local t=$1
  local n
  n=$(psql_ct -tAc "\"select count(*) from information_schema.tables where table_name='$t'\"" | tr -d '[:space:]')
  if [[ "$n" == "1" ]]; then printf '  %s[ok]%s tabela %s\n' "$C_OK" "$C_0" "$t"
  else printf '  %s[FALTA]%s tabela %s\n' "$C_ER" "$C_0" "$t"; FALTOU=1; fi
}
confere_coluna() {
  local t=$1 c=$2
  local n
  n=$(psql_ct -tAc "\"select count(*) from information_schema.columns where table_name='$t' and column_name='$c'\"" | tr -d '[:space:]')
  if [[ "$n" == "1" ]]; then printf '  %s[ok]%s %s.%s\n' "$C_OK" "$C_0" "$t" "$c"
  else printf '  %s[FALTA]%s %s.%s\n' "$C_ER" "$C_0" "$t" "$c"; FALTOU=1; fi
}

for t in ponto_employer ponto_leave ponto_allocation ponto_shift_swap \
         ponto_schedule_override ponto_assiduidade ponto_bank_request \
         ponto_homologated_machine; do confere_tabela "$t"; done
confere_coluna ponto_employee employer_id
confere_coluna ponto_employee allowed_device_ids
confere_coluna ponto_punch    employer_id
confere_coluna ponto_punch    device_id
confere_coluna ponto_device   code
confere_coluna ponto_device   rustdesk_id
confere_coluna ponto_config   assid_bonus_cents
confere_coluna ponto_config   show_bank_to_employee
confere_coluna employees      leader_id
confere_coluna employees      employer_id

if [[ "$FALTOU" == "1" ]]; then
  morre "o banco NÃO tem tudo que o código novo espera. NÃO suba o código ainda
  — a API vai estourar em toda consulta do ponto. Veja o que faltou acima."
fi

cat <<FIM

$(printf '%s' "$C_OK")[PRONTO]$(printf '%s' "$C_0") O banco tem o que o ponto novo precisa.

Agora, e só agora, o código:

  cd $FONTE
  git fetch origin && git checkout claude/ponto-paridade-rh && git pull --ff-only
  bash infra/scripts/deploy-nv-thor.sh --dry-run
  bash infra/scripts/deploy-nv-thor.sh

Depois do deploy, confira no navegador: /app/ponto deve abrir com as abas
novas (Trocas, Empregadores, Dispositivos, Alocações), e o Espelho tem que
continuar somando igual — é o único lugar onde dois cálculos foram fundidos.

FIM
