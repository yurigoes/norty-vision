/**
 * Os mesmos sete GUCs, agora como um CTE — pra quem precisa de UMA instrução.
 *
 * `runWithContext()` custa quatro idas ao Postgres (BEGIN, set_config, a
 * consulta, COMMIT). Quando a consulta é uma só e cabe num statement, dá pra
 * pagar UMA: o CTE `ctx` seta os GUCs e todo o resto da instrução depende dele.
 *
 * A dependência é o que garante a ordem, e ela precisa de DUAS coisas juntas:
 *
 *   1. o lado LATERAL tem que REFERENCIAR `ctx` (ver `TIED_TO_CTX`);
 *   2. e terminar em `OFFSET 0`.
 *
 * Sem (2), o planejador achata o subselect no plano de junção e pode pôr o
 * `ctx` do lado de DENTRO do nested loop — as tabelas são varridas antes de
 * `set_config` rodar, o RLS barra tudo e a consulta volta vazia. Isso não é
 * teoria: aconteceu aqui, com três tabelas na junção, e o `EXPLAIN` mostrava
 * `CTE Scan on ctx` como lado interno. `OFFSET 0` é a trava clássica de
 * otimização do Postgres: impede o achatamento, e aí a dependência do LATERAL
 * obriga `ctx` a ser o lado de fora.
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

/**
 * O canário.
 *
 * A ordem dentro da instrução vem da dependência dos CTEs, e isso é uma
 * afirmação sobre o executor do Postgres — não uma promessa escrita em pedra.
 * Este CTE lê o GUC pelo mesmo caminho que as tabelas leem: se `set_config`
 * ainda não tiver rodado, `current_setting(..., true)` volta NULL e quem
 * chamou sabe, na hora, que precisa refazer pelo caminho transacional.
 *
 * Sem ele o sintoma seria mudo — consulta vazia, indistinguível de "não achei
 * esse registro".
 */
export const PROOF_CTE = `prova AS MATERIALIZED (
    SELECT p.aplicado FROM ctx, LATERAL (
      SELECT current_setting('app.is_platform_admin', true) AS aplicado
       WHERE ctx.is_platform_admin IS NOT NULL
      OFFSET 0
    ) p
  )`;

/** Coluna a incluir no SELECT final; `null` = os GUCs não valiam. */
export const PROOF_SELECT = `(SELECT aplicado FROM prova) AS guc_aplicado`;

/**
 * Amarra uma leitura ao `ctx`.
 *
 * `FROM ctx, LATERAL (...)` só garante a ordem se o lado de dentro REFERENCIAR
 * `ctx`. Sem isso o LATERAL é um cross join comum e o planejador pode varrer a
 * tabela antes de `set_config` rodar — a consulta volta vazia e o canário nem
 * percebe, porque ele roda no seu próprio CTE.
 *
 * Quando a busca é por um valor que não veio do contexto (um hash de cookie,
 * por exemplo), esta condição faz a amarração: é sempre verdadeira
 * (`set_config` devolve 'true' ou 'false', nunca NULL) e obriga o Postgres a
 * produzir a linha de `ctx` primeiro.
 */
export const TIED_TO_CTX = `ctx.is_platform_admin IS NOT NULL`;

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
