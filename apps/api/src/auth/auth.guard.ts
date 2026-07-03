import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createHash } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import {
  IS_PUBLIC_KEY,
  REQUIRE_PLATFORM_ADMIN_KEY,
  REQUIRE_PLATFORM_OWNER_KEY,
  REQUIRE_PERMISSION_KEY,
} from "./decorators";
import { PrismaService } from "../prisma/prisma.service";
import { loadEnv } from "../config";
import type { RequestContext } from "./session.middleware";

const NONE_CONTEXT: RequestContext = {
  userId: null,
  platformUserId: null,
  membershipId: null,
  orgId: null,
  storeId: null,
  role: null,
  isOrgAdmin: false,
  permissions: {},
  isPlatformAdmin: false,
  platformRole: null,
  techSpecsCategories: [],
  impersonating: false,
  impersonatingOrgId: null,
  impersonatorPlatformUserId: null,
};

/**
 * Guard global que (1) resolve a sessao a partir dos cookies httpOnly
 * e anexa em req.yugo, e (2) aplica autorizacao baseada nos decorators.
 *
 * Substitui o SessionMiddleware - em NestJS + Fastify, middlewares com
 * forRoutes('*') nao executam confiavelmente. Guard global executa antes
 * de cada handler.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const req = execCtx.switchToHttp().getRequest<FastifyRequest>();

    // 1. resolve sessao (cookies -> req.yugo)
    req.yugo = await this.resolveSession(req);

    // 2. autorizacao
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    if (isPublic) return true;

    const requireOwner = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PLATFORM_OWNER_KEY,
      [execCtx.getHandler(), execCtx.getClass()],
    );

    if (requireOwner) {
      if (!req.yugo.isPlatformAdmin) {
        throw new AppError(
          ErrorCode.Forbidden,
          "Esta acao requer o master da plataforma",
          403,
        );
      }
      if (req.yugo.platformRole !== "owner") {
        throw new AppError(
          ErrorCode.Forbidden,
          "Esta acao e exclusiva do dono do SaaS (suporte master nao tem acesso)",
          403,
        );
      }
      return true;
    }

    const requireMaster = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PLATFORM_ADMIN_KEY,
      [execCtx.getHandler(), execCtx.getClass()],
    );

    if (requireMaster) {
      if (!req.yugo.isPlatformAdmin) {
        throw new AppError(
          ErrorCode.Forbidden,
          "Esta acao requer o master da plataforma",
          403,
        );
      }
      return true;
    }

    if (!req.yugo.userId && !req.yugo.platformUserId) {
      throw new AppError(
        ErrorCode.Unauthorized,
        "Autenticacao requerida",
        401,
      );
    }

    // permissao configuravel: master e owner/admin da org ignoram
    const requirePermission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [execCtx.getHandler(), execCtx.getClass()],
    );
    if (
      requirePermission &&
      !req.yugo.isPlatformAdmin &&
      !req.yugo.isOrgAdmin &&
      req.yugo.permissions[requirePermission] !== true
    ) {
      throw new AppError(
        ErrorCode.Forbidden,
        `Seu perfil nao tem a permissao: ${requirePermission}`,
        403,
      );
    }

    // assinatura CANCELADA além da carência (30d): a empresa entra em modo
    // somente-leitura (consulta por até 180 dias). Bloqueia escrita; libera o
    // que é preciso pra reativar (billing/assinatura/contratos/auth).
    if (req.yugo.orgId && !req.yugo.isPlatformAdmin && !req.yugo.impersonating) {
      const method = (req.method ?? "GET").toUpperCase();
      const isWrite = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
      if (isWrite) {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const allow = ["/api/auth", "/api/subscriptions", "/api/subscription-invoices", "/api/org-contracts"].some((p) => path.startsWith(p));
        if (!allow) {
          const phase = await this.cancellationPhase(req.yugo.orgId);
          if (phase === "readonly" || phase === "ended") {
            throw new AppError(ErrorCode.Forbidden, "Assinatura cancelada: conta em modo somente-leitura. Reative a assinatura para voltar a movimentar.", 403);
          }
        }
      }
    }

    return true;
  }

  /** Fase do cancelamento: active | grace(30d) | readonly(+180d) | ended. */
  private async cancellationPhase(orgId: string): Promise<"active" | "grace" | "readonly" | "ended"> {
    const sub = await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) => tx.subscription.findFirst({ where: { organizationId: orgId }, select: { status: true, canceledAt: true } }))
      .catch(() => null);
    if (!sub || sub.status !== "canceled" || !sub.canceledAt) return "active";
    const days = (Date.now() - new Date(sub.canceledAt).getTime()) / 86400_000;
    if (days < 30) return "grace";
    if (days < 30 + 180) return "readonly";
    return "ended";
  }

  private async resolveSession(req: FastifyRequest): Promise<RequestContext> {
    const env = loadEnv();
    const ctx: RequestContext = { ...NONE_CONTEXT };

    const userToken = req.cookies?.[env.SESSION_COOKIE_NAME];
    const masterToken = req.cookies?.[env.MASTER_COOKIE_NAME];

    if (userToken) {
      try {
        const tokenHash = sha256(userToken);
        const session = await this.prisma.runWithContext(
          { isPlatformAdmin: true },
          (tx) =>
            tx.session.findUnique({
              where: { tokenHash },
              include: {
                activeMembership: {
                  include: { role: true, store: true, organization: true },
                },
              },
            }),
        );
        if (session && !session.revokedAt && session.expiresAt > new Date()) {
          const m = session.activeMembership;
          ctx.userId = session.userId;
          ctx.membershipId = m?.id ?? null;
          ctx.orgId = m?.organizationId ?? null;
          ctx.storeId = m?.storeId ?? null;
          ctx.role = m?.role.slug ?? null;
          ctx.isOrgAdmin = m?.role.slug === "owner" || m?.role.slug === "admin";
          // permissoes do papel + overrides por usuario (membership.permissions)
          ctx.permissions = mergePermissions(
            m?.role.permissions,
            (m as any)?.permissions,
          );

          this.prisma
            .runWithContext({ isPlatformAdmin: true }, (tx) =>
              tx.session.update({
                where: { id: session.id },
                data: { lastSeenAt: new Date() },
              }),
            )
            .catch(() => undefined);
        }
      } catch {
        // ignore
      }
    }

    if (masterToken) {
      try {
        const tokenHash = sha256(masterToken);
        const ps = await this.prisma.runWithContext(
          { isPlatformAdmin: true },
          (tx) =>
            tx.platformSession.findUnique({
              where: { tokenHash },
              include: { platformUser: { select: { role: true } } },
            }),
        );
        if (ps && !ps.revokedAt && ps.expiresAt > new Date()) {
          if (ps.impersonatingOrgId) {
            // IMPERSONANDO: o contexto vira o de um usuário da empresa.
            await this.applyImpersonation(ctx, ps.impersonatingOrgId, ps.platformUserId);
          } else {
            // MASTER PURO (sem impersonar): descarta qualquer contexto de
            // usuário de empresa que tenha vazado de um cookie de sessão antigo
            // (ex.: trocou de conta sem limpar cookies). Sem isso, o /app
            // herdaria o branding/identidade da empresa anterior. #108
            ctx.userId = null;
            ctx.membershipId = null;
            ctx.orgId = null;
            ctx.storeId = null;
            ctx.role = null;
            ctx.isOrgAdmin = false;
            ctx.permissions = {};
            ctx.platformUserId = ps.platformUserId;
            ctx.isPlatformAdmin = true;
            ctx.platformRole =
              (ps as any).platformUser?.role === "support" ? "support" : "owner";
            ctx.techSpecsCategories = ps.techSpecsCategories;
          }

          this.prisma
            .runWithContext({ isPlatformAdmin: true }, (tx) =>
              tx.platformSession.update({
                where: { id: ps.id },
                data: { lastSeenAt: new Date() },
              }),
            )
            .catch(() => undefined);
        }
      } catch {
        // ignore
      }
    }

    return ctx;
  }

  /**
   * Popula o contexto como se o master fosse um usuário (owner) da empresa
   * impersonada. Mantém isPlatformAdmin=false pra que todos os serviços
   * org-scoped enxerguem APENAS os dados daquela empresa (RLS por org),
   * exatamente como a empresa veria. Guarda o id do master pra auditoria.
   */
  private async applyImpersonation(
    ctx: RequestContext,
    orgId: string,
    impersonatorPlatformUserId: string,
  ): Promise<void> {
    // membership representativo: prioriza owner, depois admin, depois qualquer.
    const membership = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.membership.findFirst({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
        include: { role: true, store: true, organization: true },
      }),
    ).catch(() => null);

    ctx.impersonating = true;
    ctx.impersonatingOrgId = orgId;
    ctx.impersonatorPlatformUserId = impersonatorPlatformUserId;
    ctx.orgId = orgId;
    ctx.isPlatformAdmin = false;
    ctx.platformRole = null;

    if (membership) {
      ctx.userId = membership.userId;
      ctx.membershipId = membership.id;
      ctx.storeId = membership.storeId ?? null;
      ctx.role = membership.role?.slug ?? "owner";
      ctx.isOrgAdmin = membership.role?.slug === "owner" || membership.role?.slug === "admin";
      ctx.permissions = mergePermissions(membership.role?.permissions, (membership as any)?.permissions);
    } else {
      // empresa sem usuários: ainda assim entra como admin da org
      ctx.isOrgAdmin = true;
      ctx.role = "owner";
    }
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Permissões = papel + overrides por usuário (override vence).
 * Filtra valores não-boolean (papéis legados tinham objetos aninhados tipo
 * {"appointments":{"read":"store"}} — esses não casam com @RequirePermission
 * "appointments.read", então tem que descartar pra não vazarem com truthy).
 */
function mergePermissions(rolePerms: unknown, userPerms: unknown): Record<string, boolean> {
  const norm = (p: unknown): Record<string, boolean> => {
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  };
  return { ...norm(rolePerms), ...norm(userPerms) };
}
