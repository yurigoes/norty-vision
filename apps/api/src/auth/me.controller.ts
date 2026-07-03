import { Controller, Get } from "@nestjs/common";
import { CurrentContext, Public } from "./decorators";
import type { RequestContext } from "./session.middleware";
import { PrismaService } from "../prisma/prisma.service";

@Controller("auth")
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/auth/me
   *
   * Endpoint publico (sem AuthGuard) que retorna o contexto atual.
   * - Anonimo: { authenticated: false }
   * - User: { authenticated: true, user: {...}, master: false }
   * - Master: { authenticated: true, master: true }
   * - Ambos: ambos true
   */
  @Public()
  @Get("me")
  async me(@CurrentContext() ctx: RequestContext) {
    let mustResetPassword = false;
    if (ctx.userId) {
      const rows = await this.prisma
        .runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.user.findUnique({ where: { id: ctx.userId! }, select: { mustResetPassword: true } }),
        )
        .catch(() => null);
      mustResetPassword = rows?.mustResetPassword ?? false;
    }

    // Quando o master está impersonando, informa a empresa (banner + sair).
    let impersonating: { orgId: string; orgName: string | null } | null = null;
    if (ctx.impersonating && ctx.impersonatingOrgId) {
      const org = await this.prisma
        .runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.organization.findUnique({ where: { id: ctx.impersonatingOrgId! }, select: { name: true } }),
        )
        .catch(() => null);
      impersonating = { orgId: ctx.impersonatingOrgId, orgName: org?.name ?? null };
    }

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
