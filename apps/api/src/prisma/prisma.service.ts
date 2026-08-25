import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Wrapper do PrismaClient com lifecycle do Nest.
 *
 * RLS context: usar runWithContext() para executar queries dentro de uma
 * transacao com `SET LOCAL app.org_id = ..., app.store_id = ..., app.user_id = ...`.
 * Sem esses GUCs, qualquer SELECT em tabela RLS retorna 0 rows.
 */
/**
 * `set_config(chave, valor, true)` = SET LOCAL: vale só dentro da transação.
 * As chaves são literais nossas (não vêm de fora); só os VALORES são
 * parametrizados, então não há injeção possível aqui.
 */
const SET_CONTEXT_SQL = `SELECT
  set_config('app.org_id', $1, true),
  set_config('app.store_id', $2, true),
  set_config('app.user_id', $3, true),
  set_config('app.role', $4, true),
  set_config('app.is_org_admin', $5, true),
  set_config('app.is_platform_admin', $6, true),
  set_config('app.tech_specs_unlocked', $7, true)`;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Executa fn dentro de transacao com GUCs RLS setados.
   * Para acoes nao-autenticadas (login/healthcheck), passe ctx={} pra rodar
   * fora de qualquer escopo (so tabelas sem RLS ou com policies abertas serao
   * acessiveis).
   */
  async runWithContext<T>(
    ctx: {
      orgId?: string | null;
      storeId?: string | null;
      userId?: string | null;
      role?: string | null;
      isOrgAdmin?: boolean;
      isPlatformAdmin?: boolean;
      techSpecsUnlocked?: boolean;
    },
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    // Os sete GUCs vão em UMA instrução. Antes era um `SELECT set_config(...)`
    // por linha — sete idas e voltas ao Postgres antes de a query começar, e
    // como isto roda dentro de uma transação interativa, a conexão ficava
    // presa o tempo todo. Cada runWithContext custava 10 viagens (BEGIN + 7 +
    // query + COMMIT); agora custa 4. Como o guard de autenticação chama isto
    // em TODA requisição, era daí que vinham os picos de latência que
    // estouravam o timeout do front e derrubavam a sessão do usuário.
    const settings: string[] = [
      ctx.orgId ?? "",
      ctx.storeId ?? "",
      ctx.userId ?? "",
      ctx.role ?? "",
      ctx.isOrgAdmin ? "true" : "false",
      ctx.isPlatformAdmin ? "true" : "false",
      ctx.techSpecsUnlocked ? "true" : "false",
    ];

    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_CONTEXT_SQL, ...settings);
      return fn(tx as PrismaClient);
    });
  }
}
