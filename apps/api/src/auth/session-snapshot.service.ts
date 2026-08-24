import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
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

  async build(ctx: RequestContext): Promise<SessionSnapshot> {
    // as duas leituras extras são independentes — vão juntas
    const [mustResetPassword, impersonating] = await Promise.all([
      this.mustResetPassword(ctx),
      this.impersonating(ctx),
    ]);

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

  private async mustResetPassword(ctx: RequestContext): Promise<boolean> {
    if (!ctx.userId) return false;
    const row = await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.user.findUnique({
          where: { id: ctx.userId! },
          select: { mustResetPassword: true },
        }),
      )
      .catch(() => null);
    return row?.mustResetPassword ?? false;
  }

  /** Quando o master está impersonando, informa a empresa (banner + sair). */
  private async impersonating(
    ctx: RequestContext,
  ): Promise<{ orgId: string; orgName: string | null } | null> {
    if (!ctx.impersonating || !ctx.impersonatingOrgId) return null;
    const org = await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findUnique({
          where: { id: ctx.impersonatingOrgId! },
          select: { name: true },
        }),
      )
      .catch(() => null);
    return { orgId: ctx.impersonatingOrgId, orgName: org?.name ?? null };
  }
}
