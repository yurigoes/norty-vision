import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SNAPSHOT_SQL, type SnapshotRow } from "./guard.sql";
import type { RequestContext } from "./session.middleware";

export interface SessionSnapshot {
  authenticated: boolean;
  user: {
    id: string;
    membershipId: string | null;
    orgId: string | null;
    storeId: string | null;
    role: string | null;
    isOrgAdmin: boolean;
    permissions: Record<string, boolean> | undefined;
    mustResetPassword: boolean;
  } | null;
  master: {
    id: string | null;
    platformRole: string | null;
    techSpecsCategories: string[];
  } | null;
  impersonating: { orgId: string; orgName: string | null } | null;
}

/**
 * Monta o retrato da sessão atual (o payload de `GET /api/auth/me`).
 *
 * Vive num serviço porque duas rotas precisam dele: o próprio `/auth/me` e o
 * `/bootstrap`, que devolve sessão + empresa + loja + assinatura + atalhos numa
 * requisição só. Duplicar essa montagem em dois lugares era pedir pra elas
 * divergirem.
 */
@Injectable()
export class SessionSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O retrato da sessão, numa ida ao banco.
   *
   * As duas leituras extras — "precisa trocar a senha?" e o nome da empresa
   * impersonada — custavam uma transação cada. Agora saem juntas
   * (`SNAPSHOT_SQL`), e quem já tem os dois valores em mãos usa `compose()`
   * sem ir ao banco nenhuma vez.
   */
  async build(ctx: RequestContext): Promise<SessionSnapshot> {
    const rls = { isPlatformAdmin: true };
    const params = [ctx.userId ?? "", ctx.impersonatingOrgId ?? ""];

    let linha = await this.prisma
      .queryWithContext<SnapshotRow>(rls, SNAPSHOT_SQL, ...params)
      .then((r) => r[0] ?? null)
      .catch(() => null);

    if (linha?.guc_aplicado == null) {
      linha = await this.prisma
        .queryWithContextInTransaction<SnapshotRow>(rls, SNAPSHOT_SQL, ...params)
        .then((r) => r[0] ?? null)
        .catch(() => null);
    }

    return this.compose(ctx, {
      mustResetPassword: linha?.must_reset_password ?? false,
      impersonatingOrgName: linha?.impersonating_org_name ?? null,
    });
  }

  /**
   * O mesmo retrato, sem ir ao banco.
   *
   * O `/bootstrap` já traz `must_reset_password` e o nome da empresa
   * impersonada na sua consulta única — não faz sentido buscar de novo. Quem
   * tem os dois em mãos monta por aqui; quem não tem chama `build()`.
   */
  compose(
    ctx: RequestContext,
    extras: { mustResetPassword: boolean; impersonatingOrgName: string | null },
  ): SessionSnapshot {
    const { mustResetPassword } = extras;
    const impersonating =
      ctx.impersonating && ctx.impersonatingOrgId
        ? { orgId: ctx.impersonatingOrgId, orgName: extras.impersonatingOrgName }
        : null;

    return {
      authenticated: Boolean(ctx.userId || ctx.platformUserId),
      user: ctx.userId
        ? {
            id: ctx.userId,
            membershipId: ctx.membershipId,
            orgId: ctx.orgId,
            storeId: ctx.storeId,
            role: ctx.role,
            isOrgAdmin: ctx.isOrgAdmin,
            permissions: ctx.permissions,
            mustResetPassword,
          }
        : null,
      master: ctx.isPlatformAdmin
        ? {
            id: ctx.platformUserId,
            platformRole: ctx.platformRole,
            techSpecsCategories: ctx.techSpecsCategories,
          }
        : null,
      impersonating,
    };
  }
}
