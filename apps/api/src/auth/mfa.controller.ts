import { Body, Controller, Post, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "./decorators";
import type { RequestContext } from "./session.middleware";
import { AppError, ErrorCode } from "@yugo/shared";
import { MfaService } from "./mfa.service";

const CodeInput = z.object({
  code: z.string().regex(/^\d{6}$/),
});

@Controller("auth/mfa")
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  /**
   * POST /api/auth/mfa/setup
   * Gera secret + QR code data URL. NAO ativa MFA ainda.
   */
  @Post("setup")
  @HttpCode(200)
  async setup(@CurrentContext() ctx: RequestContext) {
    if (!ctx.userId) {
      throw new AppError(ErrorCode.Unauthorized, "Autenticacao requerida", 401);
    }
    const result = await this.mfa.startSetup(ctx.userId);
    return {
      otpauthUrl: result.otpauthUrl,
      qrCodeDataUrl: result.qrCodeDataUrl,
      // NAO devolve o secret cru por padrao (usuario escaneia QR)
    };
  }

  /**
   * POST /api/auth/mfa/enable
   * Valida o primeiro codigo e marca mfa_enabled=true.
   */
  @Post("enable")
  @HttpCode(200)
  async enable(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    if (!ctx.userId) {
      throw new AppError(ErrorCode.Unauthorized, "Autenticacao requerida", 401);
    }
    const input = CodeInput.parse(body);
    await this.mfa.enable(ctx.userId, input.code);
    return { ok: true };
  }

  /**
   * POST /api/auth/mfa/disable
   * Exige codigo TOTP valido (defesa contra cookie roubado).
   */
  @Post("disable")
  @HttpCode(200)
  async disable(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    if (!ctx.userId) {
      throw new AppError(ErrorCode.Unauthorized, "Autenticacao requerida", 401);
    }
    const input = CodeInput.parse(body);
    await this.mfa.disable(ctx.userId, input.code);
    return { ok: true };
  }
}
