import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "./session.middleware";

/**
 * Marca um endpoint como publico (sem necessidade de auth).
 * Sem ele, o AuthGuard global rejeita.
 */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Exige master (platform_user) logado.
 */
export const REQUIRE_PLATFORM_ADMIN_KEY = "requirePlatformAdmin";
export const RequirePlatformAdmin = () =>
  SetMetadata(REQUIRE_PLATFORM_ADMIN_KEY, true);

/**
 * Exige o DONO do SaaS (platform_user com role 'owner'). Bloqueia o
 * "suporte master" (role 'support'), que pode operar qualquer empresa mas
 * nao acessa a configuracao do proprio SaaS (identidade/branding, planos,
 * credenciais/cofre, integracoes da plataforma).
 */
export const REQUIRE_PLATFORM_OWNER_KEY = "requirePlatformOwner";
export const RequirePlatformOwner = () =>
  SetMetadata(REQUIRE_PLATFORM_OWNER_KEY, true);

/**
 * "Esta rota também atende o MASTER PURO (logado no painel do SaaS, sem ter
 * entrado em empresa nenhuma)."
 *
 * O padrão é o contrário: rota de empresa exige contexto de empresa. Sem isso,
 * `GET /api/customers` com o cookie do master devolvia os clientes da Acme e os
 * da Zito na mesma lista — o RLS abre tudo pro platform admin, e a impersonação
 * (que é o caminho auditado) ficava opcional.
 *
 * Use só onde a tela do painel do SaaS realmente precisa: ou a rota é do
 * próprio SaaS, ou ela recebe a empresa por parâmetro (`?organizationId=`).
 * Quando a rota é EXCLUSIVA do master, prefira `@RequirePlatformAdmin()`.
 */
export const ALLOW_SEM_EMPRESA_KEY = "allowSemEmpresa";
export const SemEmpresa = () => SetMetadata(ALLOW_SEM_EMPRESA_KEY, true);

/**
 * Exige uma permissao configuravel do papel do usuario (chave do catalogo).
 * Owner/admin da org e o master ignoram (acesso total). Demais papeis so
 * passam se a permissao estiver marcada (true) no JSON do papel.
 */
export const REQUIRE_PERMISSION_KEY = "requirePermission";
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);

/**
 * Extrai o contexto da request (req.yugo).
 *
 * Uso: @CurrentContext() ctx: RequestContext
 */
export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    return req.yugo ?? {
      userId: null,
      platformUserId: null,
      membershipId: null,
      orgId: null,
      storeId: null,
      role: null,
      isOrgAdmin: false,
      permissions: {},
      mustResetPassword: false,
      isPlatformAdmin: false,
      platformRole: null,
      techSpecsCategories: [],
      impersonating: false,
      impersonatingOrgId: null,
      impersonatingOrgName: null,
      impersonatorPlatformUserId: null,
    };
  },
);

/**
 * Atalho pra pegar so o user id (lanca se nao logado).
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const uid = req.yugo?.userId;
    if (!uid) throw new Error("Nao autenticado");
    return uid;
  },
);

/**
 * Helper de permissão para usar DENTRO de services. Same semântica do
 * @RequirePermission no controller — master/owner/admin sempre true;
 * demais checam o catálogo.
 *
 * Use quando o service precisa de um check de defesa em profundidade ou
 * quando o método não está chegando direto via controller decorado.
 *
 * Ex.: if (!ctxCan(ctx, "agenda.edit")) throw new AppError(...);
 */
export function ctxCan(ctx: RequestContext, key: string): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (ctx.isOrgAdmin) return true;
  return ctx.permissions?.[key] === true;
}
