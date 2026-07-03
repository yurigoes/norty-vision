import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../auth/decorators";
import { loadEnv } from "../config";
import { SupplierAuthService } from "./supplier-auth.service";
import { SupplierPortalService } from "./supplier-portal.service";
import { SupplierGuard } from "./supplier.guard";

const OrgSlug = z.string().regex(/^[a-z0-9-]{3,40}$/).optional();
const LoginSchema = z.object({
  identifier: z.string().min(3).max(40), // documento ou telefone
  password: z.string().min(1).max(256),
  orgSlug: OrgSlug,
});
const SetPwdSchema = z.object({ password: z.string().min(8).max(256) });
const OtpRequestSchema = z.object({ identifier: z.string().min(3).max(40), orgSlug: OrgSlug });
const OtpVerifySchema = z.object({
  identifier: z.string().min(3).max(40),
  code: z.string().min(4).max(8),
  orgSlug: OrgSlug,
});

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

@Controller("supplier-portal")
export class SupplierPortalController {
  constructor(
    private readonly auth: SupplierAuthService,
    private readonly portal: SupplierPortalService,
  ) {}

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = LoginSchema.parse(body);
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
    const ua = req.headers["user-agent"] as string | undefined;
    const r = await this.auth.login(input.identifier, input.password, ip, ua, input.orgSlug);
    const env = loadEnv();
    reply.setCookie(env.SUPPLIER_COOKIE_NAME, r.rawToken, cookieOpts(r.expiresAt.getTime() - Date.now()));
    return { ok: true, mustReset: r.mustReset };
  }

  @Public()
  @Post("auth/request-otp")
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const input = OtpRequestSchema.parse(body);
    return this.auth.requestLoginOtp(input.identifier, input.orgSlug);
  }

  @Public()
  @Post("auth/verify-otp")
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = OtpVerifySchema.parse(body);
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
    const ua = req.headers["user-agent"] as string | undefined;
    const r = await this.auth.verifyLoginOtp(input.identifier, input.code, ip, ua, input.orgSlug);
    const env = loadEnv();
    reply.setCookie(env.SUPPLIER_COOKIE_NAME, r.rawToken, cookieOpts(r.expiresAt.getTime() - Date.now()));
    return { ok: true, mustReset: r.mustReset };
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const env = loadEnv();
    const token = req.cookies?.[env.SUPPLIER_COOKIE_NAME];
    if (token) await this.auth.logout(token);
    reply.clearCookie(env.SUPPLIER_COOKIE_NAME, { path: "/" });
    return { ok: true };
  }

  @Public()
  @UseGuards(SupplierGuard)
  @Get("me")
  async me(@Req() req: FastifyRequest) {
    return { supplier: await this.portal.me(req.supplier!) };
  }

  @Public()
  @UseGuards(SupplierGuard)
  @Post("set-password")
  @HttpCode(200)
  async setPassword(@Req() req: FastifyRequest, @Body() body: unknown) {
    const input = SetPwdSchema.parse(body);
    return this.auth.setPassword(req.supplier!, input.password);
  }

  @Public()
  @UseGuards(SupplierGuard)
  @Get("patients")
  async patients(@Req() req: FastifyRequest) {
    return this.portal.patients(req.supplier!);
  }

  @Public()
  @UseGuards(SupplierGuard)
  @Get("payments")
  async payments(@Req() req: FastifyRequest) {
    return { items: await this.portal.payments(req.supplier!) };
  }

  @Public()
  @UseGuards(SupplierGuard)
  @Get("payments/:id/receipt")
  async receipt(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const id = (req.params as any).id;
    const html = await this.portal.receiptHtml(req.supplier!, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  // ============================== COSTUREIRA (produção) ==============================

  /** Fila de OSs atribuídas à costureira logada, ordenada por prazo. */
  @Public()
  @UseGuards(SupplierGuard)
  @Get("production/queue")
  async productionQueue(@Req() req: FastifyRequest) {
    return { items: await this.portal.productionQueue(req.supplier!) };
  }

  /** Detalhe da OS (com arte + roster). Só serve se atribuída à costureira logada. */
  @Public()
  @UseGuards(SupplierGuard)
  @Get("production/:id")
  async productionDetail(@Req() req: FastifyRequest, @Param("id") id: string) {
    return { order: await this.portal.productionDetail(req.supplier!, id) };
  }

  /** Pega uma OS livre (sem assignedSupplier) pra si. Idempotente. */
  @Public()
  @UseGuards(SupplierGuard)
  @Post("production/:id/pickup")
  @HttpCode(200)
  async productionPickup(@Req() req: FastifyRequest, @Param("id") id: string) {
    return { order: await this.portal.productionPickup(req.supplier!, id) };
  }

  /** Marca "Pedido pronto" — congela o valor a pagar e avança status pra "pronto". */
  @Public()
  @UseGuards(SupplierGuard)
  @Post("production/:id/done")
  @HttpCode(200)
  async productionDone(@Req() req: FastifyRequest, @Param("id") id: string) {
    return { order: await this.portal.productionDone(req.supplier!, id) };
  }

  /** Relatório do período (peças, valor, OSs feitas, pagas/pendentes). */
  @Public()
  @UseGuards(SupplierGuard)
  @Get("production/report/period")
  async productionReport(@Req() req: FastifyRequest, @Query("from") from?: string, @Query("to") to?: string) {
    return this.portal.productionReport(req.supplier!, { from, to });
  }
}
