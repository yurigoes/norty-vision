import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@yugo/shared";
import { ShellLoader } from "../bootstrap/shell.loader";
import { SessionCacheService } from "../auth/session-cache.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * O PORTEIRO DO QUE A EMPRESA CONTRATOU, NA API
 * ============================================================================
 * A tela já barrava os quatro casos — plano, nicho, sub-módulo e permissão. Mas
 * a tela é do navegador. No servidor só existiam dois porteiros:
 *
 *   - `@RequirePermission` (o que a PESSOA pode), desde sempre;
 *   - `@RequireSubmodule` (o que a EMPRESA desligou), dos sete sub-módulos.
 *
 * Faltava o principal: o PLANO. Uma empresa sem Crediário no plano via a tela
 * redirecionar pra página que vende o módulo — e `GET /api/credit/accounts`
 * respondia 200. A promessa comercial não tinha porteiro no servidor.
 *
 * Não é isolamento entre empresas: o RLS continua onde estava, e ninguém vê
 * dado de outra. É o que foi contratado.
 *
 * A conta é a MESMA da tela: `resolveOrgModules()`, através do `ShellLoader` —
 * plano + aditivos à la carte + deny-list do nicho + sub-módulos. Duas contas
 * diferentes discordariam no primeiro módulo novo.
 */
export const MODULO = "nv:modulo";
export const SUBMODULO = "nv:submodulo";

/** `@RequireModule("crediario")` — o módulo precisa estar no plano da empresa */
export const RequireModule = (chave: string) => SetMetadata(MODULO, chave);

/** `@RequireSubmodule("producao.costureiras")` — o master não pode ter desligado */
export const RequireSubmodule = (chave: string) => SetMetadata(SUBMODULO, chave);

@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly shell: ShellLoader,
    private readonly cache: SessionCacheService,
  ) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<string>(MODULO, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    const submodulo = this.reflector.getAllAndOverride<string>(SUBMODULO, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    if (!modulo && !submodulo) return true;

    const req = execCtx.switchToHttp().getRequest();
    const ctx: RequestContext = (req as any).yugo ?? {};
    // master puro não é empresa nenhuma: o painel dele é outro. Impersonando,
    // `orgId` está setado e a regra da empresa vale — que é o certo.
    if (!ctx.orgId) return true;
    if (ctx.isPlatformAdmin && !ctx.orgId) return true;

    const org = await this.modulosDaEmpresa(ctx);
    if (!org) return true; // sem conseguir resolver, não inventa bloqueio

    if (modulo) {
      const foraDoPlano = org.enabledModules !== null && !org.enabledModules.includes(modulo);
      const escondidoPeloNicho = org.nicheHiddenModules.includes(modulo);
      if (foraDoPlano) {
        throw new AppError(
          ErrorCode.Forbidden,
          "Este módulo não faz parte do plano da sua empresa",
          403,
        );
      }
      if (escondidoPeloNicho) {
        throw new AppError(ErrorCode.Forbidden, "Este módulo não é do seu ramo", 403);
      }
    }

    if (submodulo && org.submoduleFeatures[submodulo] === false) {
      throw new AppError(ErrorCode.Forbidden, "Este recurso está desligado para a sua empresa", 403);
    }
    return true;
  }

  /**
   * De onde vem a conta.
   *
   * Primeiro o cache POR EMPRESA que o `/api/organizations/me` já mantém: dez
   * pessoas na loja compartilham a mesma resposta, e a guarda não custa ida
   * nenhuma ao banco. Na falta dele, a consulta única da casca — e o resultado
   * volta pro cache, pra próxima ser de graça.
   */
  private async modulosDaEmpresa(ctx: RequestContext): Promise<{
    enabledModules: string[] | null;
    nicheHiddenModules: string[];
    submoduleFeatures: Record<string, boolean>;
  } | null> {
    const doCache = await this.cache.getOrg<Record<string, unknown>>(ctx.orgId!).catch(() => null);
    const org = doCache ?? (await this.carrega(ctx));
    if (!org) return null;
    return {
      enabledModules: Array.isArray(org.enabledModules) ? (org.enabledModules as string[]) : null,
      nicheHiddenModules: Array.isArray(org.nicheHiddenModules)
        ? (org.nicheHiddenModules as string[])
        : [],
      submoduleFeatures:
        org.submoduleFeatures && typeof org.submoduleFeatures === "object"
          ? (org.submoduleFeatures as Record<string, boolean>)
          : {},
    };
  }

  private async carrega(ctx: RequestContext): Promise<Record<string, unknown> | null> {
    try {
      const { organization } = await this.shell.load(ctx);
      if (!organization) return null;
      await this.cache.setOrg(ctx.orgId!, organization).catch(() => undefined);
      return organization as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
