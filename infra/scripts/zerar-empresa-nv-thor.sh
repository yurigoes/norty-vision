#!/usr/bin/env bash
# ==============================================================================
# zerar-empresa-nv-thor.sh — zera estoque, pedidos e vendas de UMA empresa no
# Norty Vision em produção (CT 102 · Yggdrasil, banco `norty_vision`).
#
# RODA NA THOR, como root. As outras empresas não são tocadas.
#
# ------------------------------------------------------------------------------
# POR QUE ESTE SCRIPT EXISTE, SE JÁ EXISTE O /api/production/wipe-data
#
# A API tem um reset próprio (`production-wipe.service.ts`, POST
# /api/production/wipe-data, pede o slug como confirmação). Ele apaga pedidos de
# produção, orçamentos, conversas, leads, agendamentos, crediário, lentes e
# broadcast — e NÃO apaga:
#
#     • estoque (products.stock_qty, product_store_stock, stock_movements)
#     • vendas do PDV (sales, sale_items, sale_payments)
#
# Que é metade do que foi pedido. Daí este script: recorte mais estreito e mais
# fundo — estoque + pedidos + PDV, e nada mais. Conversas, leads, agendamentos
# e clientes ficam de pé.
#
# ------------------------------------------------------------------------------
# O QUE ELE ZERA  (três blocos, cada um desligável)
#
#   VENDAS DO PDV   sale_payments, sale_items, sales
#   PEDIDOS         quote_items, quotes, lens_orders,
#                   production_order_{items,roster,files,fabric},
#                   production_payment, production_art_reviews,
#                   production_orders, production_batches, lab_batches
#   ESTOQUE         stock_movements (apagado),
#                   product_store_stock.qty → 0,
#                   products.stock_qty → 0
#
# O estoque é ZERADO, não apagado: o cadastro do produto continua lá — preço,
# foto, tudo — só a quantidade vai a zero. Apagar `product_store_stock` daria o
# mesmo saldo na tela e quebraria qualquer tela que espere a linha existir.
#
# ------------------------------------------------------------------------------
# O QUE ELE *NÃO* ZERA, DE PROPÓSITO
#
#   clientes, produtos, usuários, lojas, configuração
#   conversas, leads, agendamentos, campanhas
#   ponto eletrônico (registro trabalhista — não se apaga)
#   audit_log (é o registro de quem fez o quê, inclusive isto aqui)
#   crediário: credit_purchases / credit_installments CONTINUAM.
#
# Esse último merece parágrafo. `credit_purchases.sale_id` aponta pra `sales`
# com ON DELETE SET NULL — então apagar as vendas do PDV não apaga o crediário:
# deixa a dívida de pé e solta da venda que a originou. Era isso, ou apagar
# dívida de cliente junto com um reset de estoque, o que seria bem pior. O
# script conta quantas ficam assim e avisa ANTES de você confirmar. Se a
# intenção era limpar o crediário também, isso é o `/api/production/wipe-data`
# com `credit: true` — outra operação, outra confirmação.
#
# ------------------------------------------------------------------------------
# USO
#
#   bash zerar-empresa-nv-thor.sh --lista                   # mostra os slugs
#   bash zerar-empresa-nv-thor.sh --contagem <slug>         # conta, não apaga
#   bash zerar-empresa-nv-thor.sh --sql <slug>              # imprime o SQL
#   bash zerar-empresa-nv-thor.sh <slug> --confirmo <slug>  # apaga
#
# O slug duas vezes não é burocracia: é a mesma trava do wipe-data da API. O
# primeiro escolhe a empresa, o segundo é a sua assinatura. Errar não apaga.
#
# Desligando blocos:
#   SEM_VENDAS=1   mantém as vendas do PDV
#   SEM_PEDIDOS=1  mantém pedidos/orçamentos/lentes
#   SEM_ESTOQUE=1  mantém o estoque
#   CAIXAS=1       TAMBÉM apaga os caixas do PDV (cash_registers) — fora do
#                  pedido original; use se quiser o PDV realmente limpo
#   SEM_BACKUP=1   pula o pg_dump (não recomendado)
#
# Tudo numa transação só: ou vai inteiro, ou não vai nada.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
BANCO=${BANCO:-norty_vision}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}
CT_APP=${CT_APP:-105}

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s==>%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()    { printf '%s[OK]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso() { printf '%s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre() { printf '%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

# ==============================================================================
# A ORDEM DOS DELETES, e por que é essa
#
# Lida do próprio banco (pg_constraint.confdeltype), não da intuição:
#
#   sale_items        -> sales             CASCADE
#   sale_payments     -> sales             CASCADE
#   quote_items       -> quotes            CASCADE
#   production_*      -> production_orders CASCADE  (6 tabelas)
#   lens_orders       -> sales             SET NULL
#   lens_orders       -> lab_batches       SET NULL
#   production_orders -> production_batches SET NULL
#   credit_purchases  -> sales             SET NULL   ← crediário sobrevive
#   product_store_stock -> products        CASCADE
#   stock_movements   -> products          CASCADE
#
# Nenhum RESTRICT/NO ACTION no caminho, então nada trava. Os filhos são
# apagados explicitamente mesmo tendo CASCADE: CASCADE não devolve contagem, e
# a contagem é justamente o que se confere no fim. Lotes vão DEPOIS dos pedidos
# (os pedidos apontam pra eles, não o contrário).
# ==============================================================================

# Filhos antes dos pais, lotes no fim. Esta lista é a única fonte da ordem —
# o SQL, a contagem e a conferência final todos leem dela.
VENDAS=(sale_payments sale_items sales)
PEDIDOS=(
  quote_items quotes
  lens_orders
  production_order_items production_order_roster production_order_files
  production_order_fabric production_payment production_art_reviews
  production_orders
  production_batches lab_batches
)
ESTOQUE_APAGA=(stock_movements)
ESTOQUE_ZERA=(product_store_stock products)   # update, não delete

# ------------------------------------------------------------------------------
# O SQL, numa função — pra poder ser conferido e TESTADO fora da produção.
#
# `--sql <uuid>` imprime exatamente o que seria executado, e é esse mesmo texto
# que roda no banco de teste antes de qualquer coisa chegar perto da thor. Se o
# SQL morasse embutido no meio do pct/docker não haveria como provar que o que
# foi testado é o que vai rodar.
# ------------------------------------------------------------------------------
sql_zerar() {
  local org=$1
  printf 'begin;\n'
  printf "set local statement_timeout = '600s';\n\n"

  if [[ "${SEM_VENDAS:-0}" != "1" ]]; then
    printf -- '-- vendas do PDV\n'
    for t in "${VENDAS[@]}"; do printf "delete from %s where organization_id = '%s';\n" "$t" "$org"; done
    if [[ "${CAIXAS:-0}" == "1" ]]; then
      printf -- '-- CAIXAS=1: caixas do PDV também\n'
      printf "delete from cash_registers where organization_id = '%s';\n" "$org"
    fi
    printf '\n'
  fi

  if [[ "${SEM_PEDIDOS:-0}" != "1" ]]; then
    printf -- '-- pedidos: orçamentos, lentes, produção, lotes\n'
    for t in "${PEDIDOS[@]}"; do printf "delete from %s where organization_id = '%s';\n" "$t" "$org"; done
    printf '\n'
  fi

  if [[ "${SEM_ESTOQUE:-0}" != "1" ]]; then
    printf -- '-- estoque: histórico apagado, saldos a zero (cadastro intacto)\n'
    for t in "${ESTOQUE_APAGA[@]}"; do printf "delete from %s where organization_id = '%s';\n" "$t" "$org"; done
    printf "update product_store_stock set qty = 0, updated_at = now()\n"
    printf "  where organization_id = '%s' and qty <> 0;\n" "$org"
    printf "update products set stock_qty = 0, updated_at = now()\n"
    printf "  where organization_id = '%s' and stock_qty <> 0;\n" "$org"
    printf '\n'
  fi

  printf 'commit;\n'
}

# ==============================================================================
# Daqui pra baixo é produção: precisa de pct, da thor e de root.
# ==============================================================================
psql_ct() {
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -i -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $BANCO -v ON_ERROR_STOP=1 $*"
}
# Consulta de uma linha/uma coluna, já limpa.
q() { psql_ct -tAc "\"$1\"" | tr -d '[:space:]'; }

exige_thor() {
  [[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)"
  command -v pct >/dev/null || morre "sem \`pct\` — este script roda NA THOR, não dentro do CT"
  local vivo
  vivo=$(q 'select 1' 2>/dev/null) || true
  [[ "$vivo" == "1" ]] || morre "não consegui falar com o banco $BANCO no $CONTAINER (CT $CT)."
}

# O caminho do código no host já mudou uma vez (/srv/apps-fase3 → /mnt/ssd/...),
# então pergunta-se ao Proxmox em vez de cravar. Aqui só serve pro backup.
descobre_base() {
  pct config "$CT_APP" 2>/dev/null | sed -n 's|^mp[0-9]*: \([^,]*\),mp=/opt/fase3$|\1|p' | head -1
}

# --- resolve o slug numa empresa só ------------------------------------------
# Slug inexistente, duplicado ou de empresa já excluída para aqui. Melhor não
# rodar do que rodar na empresa errada.
resolve_org() {
  local slug=$1 linha
  linha=$(psql_ct -tAc "\"select id || '|' || name || '|' || coalesce(deleted_at::text,'-') \
    from organizations where slug = '$slug'\"" | sed '/^[[:space:]]*$/d')
  local n; n=$(printf '%s\n' "$linha" | grep -c . || true)
  [[ "$n" == "1" ]] || morre "o slug '$slug' casou com $n empresa(s). Veja: bash $0 --lista"
  printf '%s' "$linha"
}

tabela_contagem() {
  local org=$1 t
  for t in "${VENDAS[@]}" "${PEDIDOS[@]}" "${ESTOQUE_APAGA[@]}"; do
    printf '  %-26s %s\n' "$t" "$(q "select count(*) from $t where organization_id = '$org'")"
  done
  printf '  %-26s %s\n' "product_store_stock qty<>0" \
    "$(q "select count(*) from product_store_stock where organization_id = '$org' and qty <> 0")"
  printf '  %-26s %s\n' "products stock_qty<>0" \
    "$(q "select count(*) from products where organization_id = '$org' and stock_qty <> 0")"
}

# ------------------------------------------------------------------------------
# modos
# ------------------------------------------------------------------------------
case "${1:-}" in
  --lista)
    exige_thor
    log "empresas no $BANCO"
    psql_ct -c "\"select slug, name, status, deleted_at from organizations order by slug\""
    exit 0
    ;;
  --sql)
    # único modo que NÃO precisa da thor: é texto. Aceita slug ou uuid; com
    # slug fora da thor não há banco pra resolver, então aí passe o uuid.
    [[ -n "${2:-}" ]] || morre "uso: bash $0 --sql <uuid-da-empresa>"
    sql_zerar "$2"
    exit 0
    ;;
  --contagem)
    exige_thor
    [[ -n "${2:-}" ]] || morre "uso: bash $0 --contagem <slug>"
    IFS='|' read -r ORG NOME EXCL <<<"$(resolve_org "$2")"
    log "empresa: $NOME  ($2)"
    [[ "$EXCL" == "-" ]] || aviso "esta empresa está marcada como excluída em $EXCL"
    echo "  id: $ORG"
    log "o que existe hoje (nada foi apagado)"
    tabela_contagem "$ORG"
    exit 0
    ;;
esac

# --- modo real ---------------------------------------------------------------
SLUG=${1:-}
[[ -n "$SLUG" ]] || morre "uso: bash $0 <slug> --confirmo <slug>
  Antes disso:  bash $0 --lista        (ver os slugs)
                bash $0 --contagem <slug>   (ver o que seria apagado)"
[[ "${2:-}" == "--confirmo" && "${3:-}" == "$SLUG" ]] || morre \
  "faltou a confirmação. Repita o slug:
    bash $0 $SLUG --confirmo $SLUG"

exige_thor
IFS='|' read -r ORG NOME EXCL <<<"$(resolve_org "$SLUG")"

log "empresa: $NOME  (slug $SLUG, id $ORG)"
[[ "$EXCL" == "-" ]] || aviso "está marcada como excluída em $EXCL — seguindo mesmo assim"
log "o que vai ser zerado"
tabela_contagem "$ORG"

# --- crediário: avisar ANTES, não depois -------------------------------------
if [[ "${SEM_VENDAS:-0}" != "1" ]]; then
  PRESAS=$(q "select count(*) from credit_purchases where organization_id = '$ORG' and sale_id is not null")
  if [[ "${PRESAS:-0}" != "0" ]]; then
    aviso "$PRESAS compra(s) de crediário estão ligadas a vendas do PDV.
  A dívida NÃO será apagada — o vínculo com a venda vira NULL (ON DELETE SET
  NULL). O cliente continua devendo; a parcela continua lá. Se você queria
  limpar o crediário também, pare aqui e use o /api/production/wipe-data com
  credit:true, que é a operação feita pra isso."
  fi
fi

# --- backup ANTES de qualquer DELETE -----------------------------------------
BASE=${BASE:-$(descobre_base)}
BACKUPS=${BACKUPS:-${BASE:+$BASE/.norty-vision-backups}}
if [[ "${SEM_BACKUP:-0}" != "1" ]]; then
  [[ -n "$BACKUPS" ]] || morre "não descobri onde guardar o backup.
  Passe:  BACKUPS=/caminho bash $0 ...   (ou SEM_BACKUP=1, sem volta)"
  CARIMBO=$(date +%Y%m%d-%H%M%S)
  DUMP="$BACKUPS/norty_vision-pre-zerar-$SLUG-$CARIMBO.dump"
  mkdir -p "$BACKUPS"
  log "dump do banco antes de mexer (pode demorar)"
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    pg_dump -U postgres -d $BANCO -Fc -f /tmp/nv-pre-zerar.dump"
  pct pull "$CT" /tmp/nv-pre-zerar.dump "$DUMP"
  pct exec "$CT" -- rm -f /tmp/nv-pre-zerar.dump
  ok "backup em $DUMP ($(du -h "$DUMP" | cut -f1))"
  echo "     restaurar:  pg_restore -U postgres -d $BANCO --clean --if-exists $DUMP"
else
  aviso "SEM_BACKUP=1 — sem dump. DELETE em produção sem volta."
fi

# --- a transação -------------------------------------------------------------
# O SQL vai pro CT e de lá pro container em arquivo: stdin através de duas
# camadas (pct + docker) engole erro em silêncio.
log "zerando (transação única)"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
sql_zerar "$ORG" >"$TMP"
pct push "$CT" "$TMP" /tmp/zerar.sql
pct exec "$CT" -- bash -c "docker cp /tmp/zerar.sql $CONTAINER:/tmp/zerar.sql"
if pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $BANCO -v ON_ERROR_STOP=1 -f /tmp/zerar.sql" 2>&1 | sed 's/^/      /'; then
  ok "transação confirmada"
else
  pct exec "$CT" -- rm -f /tmp/zerar.sql 2>/dev/null || true
  morre "a transação falhou e foi desfeita inteira — nada mudou.
  ${DUMP:+O dump está em $DUMP, mas provavelmente não vai precisar dele.}"
fi
pct exec "$CT" -- rm -f /tmp/zerar.sql 2>/dev/null || true
pct exec "$CT" -- bash -c "docker exec $CONTAINER rm -f /tmp/zerar.sql" 2>/dev/null || true

# --- conferência: ficou zero mesmo? ------------------------------------------
# Sem isto o script "passa" e o erro aparece quando alguém abre o PDV.
log "conferindo"
SOBROU=0
confere_zero() {
  local rotulo=$1 n=$2
  if [[ "$n" == "0" ]]; then printf '  %s[ok]%s %s\n' "$C_OK" "$C_0" "$rotulo"
  else printf '  %s[SOBROU %s]%s %s\n' "$C_ER" "$n" "$C_0" "$rotulo"; SOBROU=1; fi
}
if [[ "${SEM_VENDAS:-0}" != "1" ]]; then
  for t in "${VENDAS[@]}"; do confere_zero "$t" "$(q "select count(*) from $t where organization_id='$ORG'")"; done
fi
if [[ "${SEM_PEDIDOS:-0}" != "1" ]]; then
  for t in "${PEDIDOS[@]}"; do confere_zero "$t" "$(q "select count(*) from $t where organization_id='$ORG'")"; done
fi
if [[ "${SEM_ESTOQUE:-0}" != "1" ]]; then
  for t in "${ESTOQUE_APAGA[@]}"; do confere_zero "$t" "$(q "select count(*) from $t where organization_id='$ORG'")"; done
  confere_zero "product_store_stock com qty<>0" \
    "$(q "select count(*) from product_store_stock where organization_id='$ORG' and qty<>0")"
  confere_zero "products com stock_qty<>0" \
    "$(q "select count(*) from products where organization_id='$ORG' and stock_qty<>0")"
fi

# as outras empresas não podem ter sido tocadas
OUTRAS=$(q "select count(*) from organizations where id <> '$ORG' and deleted_at is null")
VENDAS_OUTRAS=$(q "select count(*) from sales where organization_id <> '$ORG'")
PROD_OUTRAS=$(q "select count(*) from products where organization_id <> '$ORG' and stock_qty <> 0")
printf '  %s[info]%s outras empresas ativas: %s · vendas delas: %s · produtos delas com estoque: %s\n' \
  "$C_AZ" "$C_0" "$OUTRAS" "$VENDAS_OUTRAS" "$PROD_OUTRAS"

if [[ "$SOBROU" == "1" ]]; then
  morre "sobrou coisa. A transação foi confirmada, então isso é dado criado
  DEPOIS do delete — provavelmente o sistema está em uso agora. Pare a API
  (pct exec 105 -- docker stop nv-api) e rode de novo."
fi

cat <<FIM

$(printf '%s' "$C_OK")[PRONTO]$(printf '%s' "$C_0") $NOME está zerada: estoque, pedidos e vendas do PDV.

Continuam de pé, de propósito: clientes, produtos (cadastro), usuários, lojas,
conversas, leads, agendamentos, ponto eletrônico, audit_log e o crediário.
${DUMP:+
Backup: $DUMP}
Confira no navegador: o PDV abre sem vendas, o estoque de todo produto mostra 0,
e Pedidos/Orçamentos/Lentes abrem vazios. As outras empresas, intactas.

FIM
