import { Controller, Get } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ProvisioningService } from "./provisioning.service";

/**
 * SSO — login transparente nos sistemas externos para o usuario logado.
 * Retorna { url } em JSON; o front abre numa nova aba (mais robusto que um
 * redirect server-side, que apresentava tela branca).
 *
 *  GET /api/sso/chatwoot  -> { url } login do Chatwoot
 *  GET /api/sso/glpi      -> { url } console do GLPI
 */
@Controller("sso")
export class SsoController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Get("chatwoot")
  async chatwoot(@CurrentContext() ctx: RequestContext) {
    // master (sem userId de empresa) loga no Chatwoot como admin de todas as contas
    const r = ctx.userId
      ? await this.provisioning.chatwootSsoUrl(ctx.userId)
      : ctx.platformUserId
        ? await this.provisioning.chatwootSsoUrlForPlatformUser(ctx.platformUserId)
        : null;
    if (!ctx.userId && !ctx.platformUserId) {
      throw new AppError(ErrorCode.Unauthorized, "Login necessario", 401);
    }
    if (!r) {
      throw new AppError(
        ErrorCode.NotFound,
        ctx.platformUserId
          ? "Master ainda nao vinculado ao Chatwoot. Provisione uma empresa primeiro."
          : "Seu usuario ainda nao foi provisionado no Chatwoot",
        404,
      );
    }
    return { url: r.url };
  }

  @Get("glpi")
  async glpi(@CurrentContext() ctx: RequestContext) {
    if (!ctx.userId && !ctx.platformUserId) {
      throw new AppError(ErrorCode.Unauthorized, "Login necessario", 401);
    }
    const r = await this.provisioning.glpiConsoleUrl();
    if (!r) throw new AppError(ErrorCode.NotFound, "GLPI nao configurado", 404);
    return { url: r.url };
  }
}
