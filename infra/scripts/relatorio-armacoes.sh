#!/usr/bin/env bash
# ==============================================================================
# relatorio-armacoes.sh — quantas armações saíram num período, por categoria e
# modelo. SÓ LEITURA.
#
# Existe porque a pergunta ("quantas armações a Zito vendeu em setembro") não
# precisa esperar deploy: a resposta está no banco. A tela de Relatórios faz o
# mesmo cálculo, e este script serve tanto pra responder agora quanto pra
# conferir a tela depois — se os dois números divergirem, um dos dois está
# errado, e aí dá pra achar qual.
#
# ------------------------------------------------------------------------------
# A CONTA, QUE NÃO É ÓBVIA
#
# Numa ótica a armação sai por DOIS caminhos:
#
#   PDV              vira `sale_item` numa `sale` com status 'completed'
#   PEDIDO DE LENTE  não vira venda: baixa o estoque direto e grava um
#                    `stock_movement` com reference_type = 'lens_order'
#
# Contar só o primeiro é o erro que este script não comete. O `faturado` é só
# do PDV, de propósito: a armação que sai em pedido de lente não tem preço
# próprio — o valor dela está no pedido inteiro, junto com as lentes. Dividir
# faturado por total dá um preço médio que não existe.
#
# ------------------------------------------------------------------------------
# O PERÍODO É LIDO NO HORÁRIO DA LOJA (America/Sao_Paulo), não em UTC.
#
# Não é detalhe. Medido com os mesmos dados: uma venda às 21h30 do dia 30 de
# setembro fica DENTRO de setembro no horário daqui e FORA se o período for
# lido em UTC (lá já é 00h30 de outubro). Na conferência: 5 armações no horário
# local, 4 em UTC — e R$ 897,00 contra R$ 598,00. Ótica de shopping fecha às
# 22h; a diferença aparece todo mês.
#
# ------------------------------------------------------------------------------
# USO
#
#   bash relatorio-armacoes.sh 2026-09-01 2026-09-30
#   bash relatorio-armacoes.sh 2026-09-01 2026-09-30 outra-empresa
#
# Roda no HOST Proxmox (tyr), como root. Pode rodar na thor também: é leitura,
# e os dois replicam o Postgres.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
BANCO=${BANCO:-norty_vision}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}

DE=${1:-}
ATE=${2:-}
EMPRESA=${3:-zito-oticas}

C_OK=$'\033[32m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s==>%s %s\n' "$C_AZ" "$C_0" "$*"; }
morre() { printf '%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

data_ok() { [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; }
if ! data_ok "$DE" || ! data_ok "$ATE"; then
  morre "uso: bash $0 AAAA-MM-DD AAAA-MM-DD [slug-da-empresa]
  exemplo:  bash $0 2026-09-01 2026-09-30"
fi
[[ "$DE" < "$ATE" || "$DE" == "$ATE" ]] || morre "a data inicial ($DE) é depois da final ($ATE)"

[[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)"
command -v pct >/dev/null || morre "sem \`pct\` — este script roda no HOST Proxmox, não dentro do CT"
printf '%s[OK]%s máquina: %s\n' "$C_OK" "$C_0" "$(hostname -s)"

# psql dentro do CT, com a senha vinda do .env da infra compartilhada: ela
# NUNCA aparece na linha de comando.
psql_ct() {
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -i -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $BANCO $*"
}

# --- a empresa existe? Sem isto, slug errado e período sem venda dão a mesma
#     saída vazia, e não há como saber qual dos dois foi.
NOME=$(psql_ct -tAc "\"select name from organizations where slug = '$EMPRESA'\"" | tr -d '\r' | head -1)
if [[ -z "${NOME// /}" ]]; then
  printf '%s[ERRO]%s nenhuma empresa com o slug \`%s\`. As que existem:\n' "$C_ER" "$C_0" "$EMPRESA" >&2
  psql_ct -tAc "\"select '  ' || slug || '   (' || name || ')' from organizations order by slug\"" >&2
  exit 1
fi

log "$NOME — de $DE até $ATE"

SQL=$(mktemp /tmp/rel-armacoes.XXXXXX.sql)
trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<'SQLFIM'
\set ON_ERROR_STOP on
-- SO LEITURA: qualquer escrita acidental daqui pra frente falha.
set default_transaction_read_only = on;
set timezone = 'America/Sao_Paulo';
\pset footer off
\pset null ''

with org as (
  select id, name from organizations where slug = :'empresa'
),
pdv as (
  select si.product_id, si.product_name,
         sum(si.qty)::int as qty, sum(si.line_total_cents)::bigint as cents
    from sale_items si
    join sales s on s.id = si.sale_id
    join org o   on o.id = si.organization_id
   where s.status = 'completed'
     and s.created_at >= :'de'::date
     and s.created_at <  (:'ate'::date + 1)
   group by 1, 2
),
lente as (
  select sm.product_id, (-sum(sm.qty))::int as qty
    from stock_movements sm
    join org o on o.id = sm.organization_id
   where sm.reference_type = 'lens_order'
     and sm.created_at >= :'de'::date
     and sm.created_at <  (:'ate'::date + 1)
   group by 1
  having -sum(sm.qty) > 0
),
saidas as (
  select coalesce(p.product_name, pr.name, 'Produto removido')     as nome,
         coalesce(nullif(trim(pr.category), ''), 'Sem categoria')   as categoria,
         coalesce(p.qty, 0) as qty_pdv, coalesce(l.qty, 0) as qty_lente,
         coalesce(p.cents, 0) as cents
    from pdv p
    full join lente l     on l.product_id = p.product_id
    left join products pr on pr.id = coalesce(p.product_id, l.product_id)
),
por_categoria as (
  select 2 as ordem, 'categoria: ' || categoria as o_que,
         sum(qty_pdv + qty_lente) as total, sum(qty_pdv) as pdv,
         sum(qty_lente) as pedido_de_lente, sum(cents) as cents
    from saidas group by categoria
),
so_armacoes as (
  select 1 as ordem, 'ARMAÇÕES NO PERÍODO' as o_que,
         sum(qty_pdv + qty_lente) as total, sum(qty_pdv) as pdv,
         sum(qty_lente) as pedido_de_lente, sum(cents) as cents
    from saidas where categoria ilike '%arma%'
),
por_modelo as (
  select 3 as ordem, '    ' || nome as o_que,
         (qty_pdv + qty_lente) as total, qty_pdv as pdv,
         qty_lente as pedido_de_lente, cents
    from saidas order by (qty_pdv + qty_lente) desc, nome limit 40
)
select o_que as "o que", total, pdv as "pelo PDV", pedido_de_lente as "por pedido de lente",
       'R$ ' || translate(to_char(cents / 100.0, 'FM999,999,990.00'), ',.', '.,') as "faturado (só PDV)"
  from (select * from so_armacoes union all select * from por_categoria union all select * from por_modelo) t
 where total is not null
 order by ordem, total desc;
SQLFIM

pct push "$CT" "$SQL" /tmp/rel-armacoes.sql
pct exec "$CT" -- bash -c "docker cp /tmp/rel-armacoes.sql $CONTAINER:/tmp/rel-armacoes.sql"
pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
  docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
  psql -U postgres -d $BANCO -q \
    -v empresa='$EMPRESA' -v de='$DE' -v ate='$ATE' -f /tmp/rel-armacoes.sql"
pct exec "$CT" -- rm -f /tmp/rel-armacoes.sql 2>/dev/null || true
pct exec "$CT" -- bash -c "docker exec $CONTAINER rm -f /tmp/rel-armacoes.sql" 2>/dev/null || true

cat <<TXT

O \`faturado\` é SÓ do PDV: a armação que saiu em pedido de lente não tem preço
próprio — o valor dela está no pedido inteiro, junto com as lentes. Dividir
faturado por total dá um preço médio que não existe.

TXT
