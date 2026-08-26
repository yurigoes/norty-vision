import { CONTEXT_CTE, PROOF_CTE, PROOF_SELECT, TIED_TO_CTX } from "../prisma/rls-context";

/**
 * TRANSAÇÕES: TRÊS FONTES, UMA LISTA, UM TOTAL
 * ============================================================================
 * A tela junta pagamentos do PDV (`sale_payments`), parcelas de crediário
 * (`credit_installments`) e links da InfinitePay. Isso era feito assim:
 *
 *   três findMany, cada um com `take: 300`, concatenados e ordenados por data
 *   no Node.
 *
 * Três problemas de uma vez:
 *
 * 1. **o teto era por fonte, não pela lista.** 300 pagamentos do PDV + 300
 *    parcelas + 300 links = 900 registros que podem ser todos de janeiro, e
 *    fevereiro inteiro fica invisível.
 * 2. **a ordenação era mentira.** Ordenar por data DEPOIS de cortar cada fonte
 *    em 300 não dá as 300 transações mais recentes: dá as 300 mais recentes de
 *    cada fonte, misturadas. Uma loja que vende muito no PDV e pouco no
 *    crediário via as parcelas antigas empurrarem as vendas recentes pra fora.
 * 3. **não dava pra paginar.** Sem uma ordem única sobre o conjunto, `offset`
 *    não significa nada.
 *
 * Aqui as três viram um `UNION ALL` no banco, com as mesmas colunas e um
 * critério de ordem só (`at DESC, id`). Aí `LIMIT`/`OFFSET` passam a valer, e
 * o `count` sobre o mesmo `UNION` dá o total de verdade.
 *
 * A ordem dentro da instrução segue a mesma trava do resto do sistema: cada
 * leitura entra por `FROM ctx, LATERAL (...) OFFSET 0`, senão o planejador
 * varre as tabelas antes do `set_config` e o RLS devolve vazio (calado).
 *
 * $8 = filtro de status ('' = todos).
 */
const FONTES = `
      SELECT f.* FROM ctx, LATERAL (
        SELECT 'sale'::text AS kind,
               'mp'::text AS provider,
               sp.id,
               'PDV'::text AS origin,
               sp.method || COALESCE(' (' || sp.card_type || ')', '') AS method,
               sp.amount_cents,
               sp.status,
               sp.mp_payment_id,
               s.short_code AS ref,
               NULL::text AS who,
               sp.created_at AS at
          FROM sale_payments sp
          LEFT JOIN sales s ON s.id = sp.sale_id
         WHERE sp.provider = 'mp'
           AND (nullif($8, '') IS NULL OR sp.status = $8)
           AND ${TIED_TO_CTX}
        OFFSET 0
      ) f

      UNION ALL

      SELECT f.* FROM ctx, LATERAL (
        SELECT CASE WHEN true THEN 'installment' END::text AS kind,
               'mp'::text AS provider,
               ci.id,
               'Crediário'::text AS origin,
               COALESCE(ci.payment_method, 'mp') AS method,
               ci.amount_cents,
               ci.status,
               ci.mp_payment_id,
               'parcela ' || ci.number::text AS ref,
               ca.holder_name AS who,
               ci.updated_at AS at
          FROM credit_installments ci
          LEFT JOIN credit_accounts ca ON ca.id = ci.credit_account_id
         WHERE (ci.mp_payment_id IS NOT NULL OR ci.mp_init_point IS NOT NULL)
           AND (nullif($8, '') IS NULL OR ci.status = $8)
           AND ${TIED_TO_CTX}
        OFFSET 0
      ) f

      UNION ALL

      SELECT f.* FROM ctx, LATERAL (
        SELECT CASE WHEN ip.kind = 'installment' THEN 'installment' ELSE 'sale' END::text AS kind,
               'infinitepay'::text AS provider,
               ip.id,
               'InfinitePay (link)'::text AS origin,
               'InfinitePay' || COALESCE(' (' || CASE WHEN ip.capture_method = 'credit_card' THEN 'cartão' ELSE ip.capture_method END || ')', '') AS method,
               ip.amount_cents,
               ip.status,
               NULL::text AS mp_payment_id,
               CASE WHEN ip.kind = 'installment' THEN 'parcela' ELSE 'venda' END::text AS ref,
               NULL::text AS who,
               COALESCE(ip.updated_at, ip.created_at) AS at
          FROM infinitepay_link ip
         WHERE (nullif($8, '') IS NULL OR ip.status = $8)
           AND ${TIED_TO_CTX}
        OFFSET 0
      ) f`;

/** a página: $9 = limit, $10 = offset */
export const TRANSACTIONS_SQL = `WITH ${CONTEXT_CTE},

  ${PROOF_CTE},

  fontes AS MATERIALIZED (${FONTES}
  )

SELECT (
         SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.at DESC, p.id), '[]'::jsonb)
           FROM (
             SELECT * FROM fontes ORDER BY at DESC, id LIMIT $9::int OFFSET $10::int
           ) p
       ) AS itens,
       (SELECT count(*) FROM fontes) AS total,
       ${PROOF_SELECT}`;

export interface TransactionsRow {
  itens: Array<{
    kind: string;
    provider: string;
    id: string;
    origin: string;
    method: string;
    amount_cents: string | number;
    status: string;
    mp_payment_id: string | null;
    ref: string | null;
    who: string | null;
    at: string;
  }>;
  total: string | number;
  guc_aplicado: string | null;
}
