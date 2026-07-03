import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LoginInput } from "@yugo/shared";
import { PlatformAuthService } from "./platform-auth.service";
import { loadEnv } from "../config";
import { Public } from "../auth/decorators";

@Controller("platform-auth")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

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

    const result = await this.auth.login({
      email: input.email,
      password: input.password,
      ipAddress,
      userAgent: userAgent ?? null,
    });

    reply.setCookie(env.MASTER_COOKIE_NAME, result.rawToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: env.SESSION_COOKIE_DOMAIN,
      path: "/",
      expires: result.expiresAt,
    });
    // Identidades mutuamente exclusivas: ao entrar como master, derruba
    // qualquer sessão de empresa que tenha sobrado num cookie antigo, pra não
    // herdar branding/contexto da empresa anterior. #108
    reply.clearCookie(env.SESSION_COOKIE_NAME, {
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN,
    });

    return {
      ok: true,
      platformUserId: result.platformUserId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const env = loadEnv();
    const raw = req.cookies?.[env.MASTER_COOKIE_NAME];
    if (raw) {
      await this.auth.logout(raw);
    }
    reply.clearCookie(env.MASTER_COOKIE_NAME, {
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN,
    });
  }
}
