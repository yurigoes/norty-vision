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
