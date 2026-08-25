/**
 * Os mesmos sete GUCs, agora como um CTE — pra quem precisa de UMA instrução.
 *
 * `runWithContext()` custa quatro idas ao Postgres (BEGIN, set_config, a
 * consulta, COMMIT). Quando a consulta é uma só e cabe num statement, dá pra
 * pagar UMA: o CTE `ctx` seta os GUCs e todo o resto da instrução depende dele.
 *
 * A dependência é o que garante a ordem. Quem lê tabela com RLS entra por
 * `FROM ctx, LATERAL (SELECT ... WHERE id = ctx.org_id ...)`: o lado LATERAL
 * é avaliado por linha de `ctx`, então `set_config` já rodou. Um CROSS JOIN
 * comum não daria essa garantia — o planejador poderia varrer a tabela antes.
 *
 * Fora de transação explícita, cada instrução é a sua própria transação, então
 * `set_config(..., true)` (SET LOCAL) morre junto com ela — nada vaza para a
 * próxima requisição que pegar a mesma conexão do pool.
 *
 * Os parâmetros $1..$7 são do contexto; a consulta de quem chama começa em $8.
 */
export const CONTEXT_CTE = `ctx AS MATERIALIZED (
    SELECT set_config('app.org_id', $1, true) AS org_id,
           set_config('app.store_id', $2, true) AS store_id,
           set_config('app.user_id', $3, true) AS user_id,
           set_config('app.role', $4, true) AS role,
           set_config('app.is_org_admin', $5, true) AS is_org_admin,
           set_config('app.is_platform_admin', $6, true) AS is_platform_admin,
           set_config('app.tech_specs_unlocked', $7, true) AS tech_specs_unlocked
  )`;

/** Quantos placeholders o CTE de contexto consome (a consulta começa no próximo). */
export const CONTEXT_PARAMS = 7;

export interface RlsContext {
  orgId?: string | null;
  storeId?: string | null;
  userId?: string | null;
  role?: string | null;
  isOrgAdmin?: boolean;
  isPlatformAdmin?: boolean;
  techSpecsUnlocked?: boolean;
}

/** Os sete valores do contexto, na ordem de $1..$7. */
export function contextParams(ctx: RlsContext): string[] {
  return [
    ctx.orgId ?? "",
    ctx.storeId ?? "",
    ctx.userId ?? "",
    ctx.role ?? "",
    ctx.isOrgAdmin ? "true" : "false",
    ctx.isPlatformAdmin ? "true" : "false",
    ctx.techSpecsUnlocked ? "true" : "false",
  ];
}
