import { Body, Controller, Post, Req, Res, HttpCode } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode, LoginInput } from "@yugo/shared";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { loadEnv } from "../config";
import { Public, CurrentContext } from "./decorators";
import type { RequestContext } from "./session.middleware";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const env = loadEnv();
    const input = LoginInput.parse(body);

    const ipAddress =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.ip ??
      null;
    const userAgent = req.headers["user-agent"] ?? null;

    const orgSlug = typeof (body as any)?.orgSlug === "string" ? (body as any).orgSlug : null;
    const result = await this.auth.login({
      email: input.email,
      password: input.password,
      mfaCode: input.mfaCode,
      ipAddress,
      userAgent: userAgent ?? null,
      orgSlug,
    });

    reply.setCookie(env.SESSION_COOKIE_NAME, result.rawToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: env.SESSION_COOKIE_DOMAIN,
      path: "/",
      expires: result.expiresAt,
    });
    // Identidades mutuamente exclusivas: ao entrar como empresa, derruba
    // qualquer sessão master sobrando num cookie antigo. #108
    reply.clearCookie(env.MASTER_COOKIE_NAME, {
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN,
    });

    return {
      ok: true,
      userId: result.userId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /** Troca da própria senha (autenticado) — usado no 1º acesso obrigatório. */
  @Post("change-password")
  @HttpCode(200)
  async changePassword(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    if (!ctx.userId) throw new AppError(ErrorCode.Unauthorized, "Sem sessão de usuário", 401);
    const input = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(200),
    }).parse(body);
    return this.auth.changeOwnPassword(ctx.userId, input.currentPassword, input.newPassword);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const env = loadEnv();
    const raw = req.cookies?.[env.SESSION_COOKIE_NAME];
    if (raw) {
      await this.session.revoke(raw, "logout");
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, {
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN,
    });
  }
}
