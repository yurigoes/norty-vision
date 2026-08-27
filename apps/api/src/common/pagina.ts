/**
 * PAGINAÇÃO DE VERDADE
 * ============================================================================
 * As rotas de listagem respondiam com `{ items: [...] }` e um `take` fixo —
 * 500 vendas, 500 contas, 1.000 parcelas. Quem chamava não tinha como saber se
 * aquilo era tudo ou um pedaço: um teto silencioso. A tela mostrava "500
 * vendas" com 3.000 no banco e ninguém percebia.
 *
 * Aqui a resposta passa a dizer a verdade:
 *
 *   { items: [...], total: 3184, limit: 50, offset: 0, hasMore: true }
 *
 * `total` custa uma segunda consulta (o `count`), na MESMA transação e no mesmo
 * contexto RLS da primeira — senão o total seria de outra empresa. É esse
 * custo que compra o "mostrando 50 de 3.184" e o "carregar mais".
 *
 * COMPATIBILIDADE: quem não pede `limit` continua recebendo o mesmo teto de
 * antes (o `padrao` de cada rota), com os mesmos itens na mesma ordem. Só ganha
 * os campos novos. Nenhuma tela quebra por causa disto; as que querem paginar
 * passam a pedir `limit`.
 */
export interface Pagina<T> {
  items: T[];
  /** quantos existem no servidor com estes filtros — não é items.length */
  total: number;
  limit: number;
  offset: number;
  /** ainda tem coisa depois deste pedaço? */
  hasMore: boolean;
}

/** `?limit=` do cliente: número são, dentro do teto da rota. */
export function limitePedido(bruto: unknown, padrao: number, teto: number): number {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(Math.floor(n), teto);
}

/** `?offset=` do cliente: nunca negativo. */
export function offsetPedido(bruto: unknown): number {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** o que uma listagem paginável aceita, junto dos seus próprios filtros */
export interface OpcoesDePagina {
  limit?: number;
  offset?: number;
}

/**
 * Roda `findMany` + `count` no mesmo `tx` (mesmo contexto RLS) e monta a página.
 *
 * `modelo` é o delegate do Prisma (`tx.sale`, `tx.customer`, ...). `args` é o
 * que você passaria pro `findMany` — sem `take`/`skip`, que vêm daqui.
 */
/**
 * ORDEM ESTÁVEL — sem isto a paginação mente.
 * ============================================================================
 * `offset` só funciona se duas consultas seguidas devolverem as linhas na mesma
 * ordem. Um `orderBy: { createdAt: "desc" }` não garante isso: 180 orçamentos
 * criados na mesma transação têm o MESMO `created_at`, o Postgres desempata
 * como quiser, e a página 2 repete linhas da 1 e pula outras. Aconteceu de
 * verdade aqui — a lista voltava diferente a cada pedido.
 *
 * Então toda consulta paginada ganha `id` como último critério. É único, então
 * a ordem passa a ser total: não sobra empate pra ninguém desempatar.
 */
function comDesempate(orderBy: any): any[] {
  const lista = orderBy == null ? [] : Array.isArray(orderBy) ? [...orderBy] : [orderBy];
  const jaTemId = lista.some((o) => o && typeof o === "object" && "id" in o);
  return jaTemId ? lista : [...lista, { id: "asc" }];
}

export async function paginar<T>(
  modelo: {
    findMany: (args: any) => Promise<T[]>;
    count: (args: any) => Promise<number>;
  },
  args: { where?: any; orderBy?: any; include?: any; select?: any },
  opts: { limit: number; offset: number },
): Promise<Pagina<T>> {
  const { limit, offset } = opts;
  const [items, total] = await Promise.all([
    modelo.findMany({ ...args, orderBy: comDesempate(args.orderBy), take: limit, skip: offset }),
    modelo.count({ where: args.where }),
  ]);
  return { items, total, limit, offset, hasMore: offset + items.length < total };
}

/** Mesma forma de resposta, quando a lista já veio pronta (montada na mão). */
export function paginaDeMemoria<T>(todos: T[], opts: { limit: number; offset: number }): Pagina<T> {
  const { limit, offset } = opts;
  const items = todos.slice(offset, offset + limit);
  return { items, total: todos.length, limit, offset, hasMore: offset + items.length < todos.length };
}

/**
 * TODAS AS LINHAS, EM PEDAÇOS — pra exportar sem teto silencioso.
 * ============================================================================
 * O CSV e o PDF de contas a pagar/receber chamavam a listagem e recebiam o
 * teto dela: 1.000 parcelas. Quem exportava um ano de contas recebia um
 * arquivo truncado **sem nenhum aviso** — e ia conferir contra o contador com
 * um número errado.
 *
 * Aqui a lista é percorrida em pedaços até acabar. O `teto` existe pra que uma
 * empresa com meio milhão de parcelas não derrube a API: quando ele é
 * alcançado, `truncado` volta `true` e quem chamou É OBRIGADO a dizer isso no
 * arquivo. Truncar acontece; truncar calado é que não pode.
 */
export async function todasAsPaginas<T>(
  buscar: (limit: number, offset: number) => Promise<Pagina<T>>,
  opts?: { pedaco?: number; teto?: number },
): Promise<{ items: T[]; total: number; truncado: boolean }> {
  const pedaco = opts?.pedaco ?? 1000;
  const teto = opts?.teto ?? 50_000;
  const items: T[] = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const p = await buscar(Math.min(pedaco, teto - items.length), offset);
    total = p.total;
    items.push(...p.items);
    if (!p.hasMore || p.items.length === 0 || items.length >= teto) break;
    offset += p.items.length;
  }
  return { items, total, truncado: items.length < total };
}
