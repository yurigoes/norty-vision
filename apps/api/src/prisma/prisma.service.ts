import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Wrapper do PrismaClient com lifecycle do Nest.
 *
 * RLS context: usar runWithContext() para executar queries dentro de uma
 * transacao com `SET LOCAL app.org_id = ..., app.store_id = ..., app.user_id = ...`.
 * Sem esses GUCs, qualquer SELECT em tabela RLS retorna 0 rows.
 */
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
    return this.$transaction(async (tx) => {
      const settings: Array<[string, string]> = [
        ["app.org_id", ctx.orgId ?? ""],
        ["app.store_id", ctx.storeId ?? ""],
        ["app.user_id", ctx.userId ?? ""],
        ["app.role", ctx.role ?? ""],
        ["app.is_org_admin", ctx.isOrgAdmin ? "true" : "false"],
        ["app.is_platform_admin", ctx.isPlatformAdmin ? "true" : "false"],
        ["app.tech_specs_unlocked", ctx.techSpecsUnlocked ? "true" : "false"],
      ];
      for (const [key, value] of settings) {
        // SET LOCAL e setting que dura a transacao
        await tx.$executeRawUnsafe(`SELECT set_config($1, $2, true)`, key, value);
      }
      return fn(tx as PrismaClient);
    });
  }
}
