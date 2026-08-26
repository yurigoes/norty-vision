import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * O PORTEIRO DO SUB-MÓDULO, NA API
 * ============================================================================
 * A tela já barra: desligar `producao.costureiras` no master tira o item do
 * menu E fecha a rota. Mas a tela é do navegador — quem abrir o devtools e
 * chamar `/api/production/by-supplier/x/report` continuava passando, porque
 * esses endpoints não checavam nada.
 *
 * `assertSubmodule` já existia dentro da Produção, chamado à mão em sete
 * lugares — e esquecido nos das costureiras, que eram justamente os da tela
 * que a gente acabou de fechar. Guarda que se aplica por decorador não tem
 * como ser esquecida no meio de um controller.
 *
 * Não é o isolamento entre empresas — isso é o RLS, e continua onde estava.
 * Isto é o que a empresa contratou.
 */
export const SUBMODULO = "nv:submodulo";

/** `@RequireSubmodule("producao.costureiras")` no controller ou na rota */
export const RequireSubmodule = (chave: string) => SetMetadata(SUBMODULO, chave);

@Injectable()
export class SubmoduloGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const chave = this.reflector.getAllAndOverride<string>(SUBMODULO, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    if (!chave) return true;

    const req = execCtx.switchToHttp().getRequest();
    const ctx: RequestContext = (req as any).yugo ?? {};
    // master puro não é empresa nenhuma: o painel dele é outro
    if (ctx.isPlatformAdmin || !ctx.orgId) return true;

    const s = await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.callCenterSettings.findFirst({
          where: { organizationId: ctx.orgId! },
          select: { submoduleFeatures: true, productionFeatures: true },
        }),
      )
      .catch(() => null);

    const mapa = (s as any)?.submoduleFeatures;
    const desligado =
      mapa && typeof mapa === "object" && !Array.isArray(mapa)
        ? mapa[chave] === false
        : // legado da Produção: chaves soltas em production_features
          chave.startsWith("producao.") &&
          (s as any)?.productionFeatures?.[chave.slice("producao.".length)] === false;

    if (desligado) {
      throw new AppError(
        ErrorCode.Forbidden,
        "Este recurso está desligado para a sua empresa",
        403,
      );
    }
    return true;
  }
}
