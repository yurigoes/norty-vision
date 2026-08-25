import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
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
import { SessionCacheService } from "./session-cache.service";
import {
  SESSION_SQL,
  CANCELLATION_SQL,
  type SessionRow,
  type CancellationRow,
  type LinhaMaster,
  type LinhaImpersonacao,
} from "./guard.sql";
import { loadEnv } from "../config";
import type { RequestContext } from "./session.middleware";

/** O que vai pro cache: só o que o guard monta a partir do banco. */
type ContextoUsuario = Pick<
  RequestContext,
  "userId" | "membershipId" | "orgId" | "storeId" | "role" | "isOrgAdmin" | "permissions"
>;

/** O que vai pro cache do master: a sessão dele e a empresa impersonada. */
interface CacheMaster {
  master: LinhaMaster;
  impersonado: LinhaImpersonacao | null;
}

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
  private readonly logger = new Logger("Auth");
  /** avisa uma vez só, pra não inundar o log */
  private avisouSessao = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cache: SessionCacheService,
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
    const linhas = await this.prisma
      .queryWithContext<CancellationRow>({ isPlatformAdmin: true }, CANCELLATION_SQL, orgId)
      .catch(() => null);
    // canário desligado: só o caminho transacional pode responder com confiança
    const linha =
      linhas?.[0]?.guc_aplicado != null
        ? linhas[0]
        : await this.prisma
            .queryWithContextInTransaction<CancellationRow>(
              { isPlatformAdmin: true },
              CANCELLATION_SQL,
              orgId,
            )
            .catch(() => null)
            .then((r) => r?.[0] ?? null);
    const sub = linha?.assinatura ?? null;
    if (!sub || sub.status !== "canceled" || !sub.canceledAt) return "active";
    const days = (Date.now() - new Date(sub.canceledAt).getTime()) / 86400_000;
    if (days < 30) return "grace";
    if (days < 30 + 180) return "readonly";
    return "ended";
  }

  /**
   * Quem é esta pessoa — em uma ida ao banco (ou nenhuma).
   *
   * Antes eram até três transações: a sessão do usuário (com `include`, que
   * vira uma consulta por tabela), a do master e, se estivesse impersonando,
   * a busca do membership representativo. Agora é uma instrução só
   * (`session.sql.ts`) — e, com a sessão quente no Redis, nem isso.
   */
  private async resolveSession(req: FastifyRequest): Promise<RequestContext> {
    const env = loadEnv();
    const ctx: RequestContext = { ...NONE_CONTEXT };

    const userToken = req.cookies?.[env.SESSION_COOKIE_NAME];
    const masterToken = req.cookies?.[env.MASTER_COOKIE_NAME];
    if (!userToken && !masterToken) return ctx;

    const userHash = userToken ? sha256(userToken) : "";
    const masterHash = masterToken ? sha256(masterToken) : "";

    try {
      // 1) cache: absorve a rajada de requisições de uma mesma tela sem tocar
      //    no banco. Os dois lados têm cache próprio — se os dois cookies
      //    estiverem quentes, a requisição não vai ao banco nenhuma vez.
      const doUsuario = userHash ? await this.cache.get<ContextoUsuario>(userHash) : null;
      const doMaster = masterHash ? await this.cache.getMaster<CacheMaster>(masterHash) : null;

      // basta um lado faltando pra valer a consulta — ela traz os dois
      const faltaAlgo = (Boolean(userHash) && !doUsuario) || (Boolean(masterHash) && !doMaster);
      const linha = faltaAlgo ? await this.consultaSessao(userHash, masterHash) : null;

      if (doUsuario) Object.assign(ctx, doUsuario);
      else if (linha) await this.aplicaUsuario(ctx, linha, userHash);

      // o master vem DEPOIS: master puro descarta o contexto de empresa
      if (doMaster) await this.aplicaMaster(ctx, doMaster.master, doMaster.impersonado, masterHash, false);
      else if (linha) await this.aplicaMaster(ctx, linha.master, linha.impersonado, masterHash, true);

      // 2) "sessão ativa": escrita no banco no máximo a cada 5 min, e não a
      //    cada clique. O valor só serve pra saber que a sessão está viva.
      if (ctx.userId && userHash && (await this.cache.deveMarcarAtividade(userHash))) {
        this.prisma
          // cache-ok: só carimba "visto por último"; não muda papel nem permissão
          .runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.session.updateMany({
              where: { tokenHash: userHash },
              data: { lastSeenAt: new Date() },
            }),
          )
          .catch(() => undefined);
      }
    } catch {
      // ignore
    }

    return ctx;
  }

  /** Sessão do usuário + sessão do master + membership impersonado, numa ida. */
  private async consultaSessao(userHash: string, masterHash: string): Promise<SessionRow | null> {
    const rls = { isPlatformAdmin: true };
    const linhas = await this.prisma
      .queryWithContext<SessionRow>(rls, SESSION_SQL, userHash, masterHash)
      .catch(() => null);
    const linha = linhas?.[0] ?? null;

    // DUAS redes. O canário diz se os GUCs valiam; a segunda olha a
    // CONSEQUÊNCIA: veio cookie e não achamos NADA. Quase sempre é cookie
    // velho — e aí a segunda consulta é o preço de um pedido já perdido —,
    // mas é também como um RLS barrado se manifestaria, e aqui isso
    // significaria deslogar todo mundo em silêncio.
    const canario = linha?.guc_aplicado != null;
    const achou = Boolean(linha?.sessao || linha?.master);
    if (linha && canario && achou) return linha;

    if (!this.avisouSessao && !canario) {
      this.avisouSessao = true;
      this.logger.warn(
        "os GUCs do RLS não valiam na consulta da sessão — refazendo dentro de " +
          "transação. Se isto se repetir, confira o plano: cada LATERAL precisa " +
          "referenciar `ctx` e terminar em OFFSET 0.",
      );
    }

    const seguro = await this.prisma
      .queryWithContextInTransaction<SessionRow>(rls, SESSION_SQL, userHash, masterHash)
      .catch(() => null);
    return seguro?.[0] ?? linha;
  }

  private async aplicaUsuario(ctx: RequestContext, linha: SessionRow, userHash: string): Promise<void> {
    const s = linha.sessao;
    if (!s || !viva(s.revokedAt, s.expiresAt)) return;

    const resolvido: ContextoUsuario = {
      userId: s.userId,
      membershipId: s.membershipId,
      orgId: s.orgId,
      storeId: s.storeId,
      role: s.roleSlug,
      isOrgAdmin: s.roleSlug === "owner" || s.roleSlug === "admin",
      // permissoes do papel + overrides por usuario (membership.permissions)
      permissions: mergePermissions(s.rolePermissions, s.membershipPermissions),
    };
    Object.assign(ctx, resolvido);
    // indexado por usuário e por papel: é assim que uma troca de permissão
    // derruba a sessão de quem nem está com o navegador aberto
    if (userHash) {
      await this.cache.set(userHash, resolvido, { userId: s.userId, roleId: s.roleId });
    }
  }

  private async aplicaMaster(
    ctx: RequestContext,
    ps: LinhaMaster | null,
    impersonado: LinhaImpersonacao | null,
    masterHash: string,
    guardarNoCache: boolean,
  ): Promise<void> {
    if (!ps || !viva(ps.revokedAt, ps.expiresAt)) return;

    if (guardarNoCache && masterHash) {
      await this.cache.setMaster(masterHash, ps.platformUserId, { master: ps, impersonado });
    }

    if (ps.impersonatingOrgId) {
      // IMPERSONANDO: o contexto vira o de um usuário da empresa.
      this.applyImpersonation(ctx, ps.impersonatingOrgId, ps.platformUserId, impersonado);
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
      ctx.platformRole = ps.platformUserRole === "support" ? "support" : "owner";
      ctx.techSpecsCategories = ps.techSpecsCategories ?? [];
    }

    // mesma regra do usuário: "visto por último" no máximo a cada 5 min. Aqui
    // era gravado a CADA requisição do master — uma transação por clique numa
    // linha quente.
    if (masterHash && (await this.cache.deveMarcarAtividade(masterHash))) {
      this.prisma
        // cache-ok: só carimba "visto por último" do master
        .runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.platformSession.update({
            where: { id: ps.id },
            data: { lastSeenAt: new Date() },
          }),
        )
        .catch(() => undefined);
    }
  }

  /**
   * Popula o contexto como se o master fosse um usuário (owner) da empresa
   * impersonada. Mantém isPlatformAdmin=false pra que todos os serviços
   * org-scoped enxerguem APENAS os dados daquela empresa (RLS por org),
   * exatamente como a empresa veria. Guarda o id do master pra auditoria.
   *
   * O membership representativo é o mais antigo da empresa — vem na mesma
   * consulta, no CTE `imp`.
   */
  private applyImpersonation(
    ctx: RequestContext,
    orgId: string,
    impersonatorPlatformUserId: string,
    membership: LinhaImpersonacao | null,
  ): void {
    ctx.impersonating = true;
    ctx.impersonatingOrgId = orgId;
    ctx.impersonatorPlatformUserId = impersonatorPlatformUserId;
    ctx.orgId = orgId;
    ctx.isPlatformAdmin = false;
    ctx.platformRole = null;

    if (membership) {
      ctx.userId = membership.userId;
      ctx.membershipId = membership.membershipId;
      ctx.storeId = membership.storeId ?? null;
      ctx.role = membership.roleSlug ?? "owner";
      ctx.isOrgAdmin = membership.roleSlug === "owner" || membership.roleSlug === "admin";
      ctx.permissions = mergePermissions(membership.rolePermissions, membership.membershipPermissions);
    } else {
      // empresa sem usuários: ainda assim entra como admin da org
      ctx.isOrgAdmin = true;
      ctx.role = "owner";
    }
  }
}

/** Sessão de pé: não revogada e dentro da validade. */
function viva(revokedAt: string | null, expiresAt: string): boolean {
  return revokedAt == null && new Date(expiresAt) > new Date();
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
