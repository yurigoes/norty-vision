import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SupportAccessService } from "../support-access/support-access.service";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Impersonação do master. A autorização NÃO depende do contexto da request
 * (que durante a impersonação já está "rebaixado" para a empresa); validamos
 * o cookie do master diretamente contra platform_sessions.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger("Impersonation");

  constructor(
    private readonly prisma: PrismaService,
    private readonly supportAccess: SupportAccessService,
  ) {}

  /** Valida o cookie do master e devolve a sessão ativa. */
  private async requireMasterSession(rawToken: string | undefined) {
    if (!rawToken) throw new AppError(ErrorCode.Unauthorized, "Sessão master necessária", 401);
    const tokenHash = sha256(rawToken);
    const ps = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformSession.findUnique({
        where: { tokenHash },
        include: { platformUser: { select: { id: true, role: true, name: true } } },
      }),
    );
    if (!ps || ps.revokedAt || ps.expiresAt <= new Date()) {
      throw new AppError(ErrorCode.Unauthorized, "Sessão master inválida", 401);
    }
    return ps;
  }

  /** Master começa a impersonar uma empresa. */
  async start(rawToken: string | undefined, organizationId: string) {
    const ps = await this.requireMasterSession(rawToken);

    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Empresa não encontrada", 404);

    // suporte master só entra em empresas com acesso de suporte ativo;
    // o owner (dono do SaaS) tem acesso total e não precisa de token.
    if (ps.platformUser?.role === "support") {
      const ok = await this.supportAccess.hasActiveGrant(org.id);
      if (!ok) throw new AppError(ErrorCode.Forbidden, "Sem acesso de suporte ativo para esta empresa. Solicite a liberação do acesso.", 403);
    }

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformSession.update({
        where: { id: ps.id },
        data: { impersonatingOrgId: org.id },
      }),
    );

    await this.audit(organizationId, ps.platformUserId, "impersonation.start").catch(() => undefined);
    this.logger.log(`master ${ps.platformUserId} começou a impersonar org ${org.id}`);
    return { ok: true, orgId: org.id, orgName: org.name };
  }

  /** Master sai da impersonação e volta ao modo master. */
  async stop(rawToken: string | undefined) {
    const ps = await this.requireMasterSession(rawToken);
    const wasOrg = ps.impersonatingOrgId;
    if (wasOrg) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.platformSession.update({
          where: { id: ps.id },
          data: { impersonatingOrgId: null },
        }),
      );
      await this.audit(wasOrg, ps.platformUserId, "impersonation.stop").catch(() => undefined);
    }
    return { ok: true };
  }

  /** Log append-only (best-effort: tabela é particionada por mês). */
  private async audit(organizationId: string, platformUserId: string, action: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO audit_log (organization_id, actor_platform_user_id, as_platform_admin, action, severity)
         VALUES ($1::uuid, $2::uuid, true, $3, 'warn')`,
        organizationId,
        platformUserId,
        action,
      ),
    );
  }
}
