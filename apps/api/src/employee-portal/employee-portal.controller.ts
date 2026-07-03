import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { Public } from "../auth/decorators";
import { loadEnv } from "../config";
import { StorageService } from "../storage/storage.service";
import { EmployeeAuthService } from "./employee-auth.service";
import { EmployeePortalService } from "./employee-portal.service";
import { EmployeeGuard } from "./employee.guard";
import { CurrentEmployee, type EmployeeContext } from "./employee-context";
import { PontoService } from "../ponto/ponto.service";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024;

function setCookie(reply: FastifyReply, token: string, expires: Date) {
  const env = loadEnv();
  reply.setCookie(env.EMPLOYEE_COOKIE_NAME, token, {
    httpOnly: true, secure: true, sameSite: "strict", domain: env.SESSION_COOKIE_DOMAIN, path: "/", expires,
  });
}

function clientIp(req: FastifyRequest): string | null {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

@Controller("employee")
export class EmployeePortalController {
  constructor(
    private readonly auth: EmployeeAuthService,
    private readonly portal: EmployeePortalService,
    private readonly storage: StorageService,
    private readonly ponto: PontoService,
  ) {}

  // ===== AUTH =====
  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { cpf, password, orgSlug } = z.object({
      cpf: z.string().min(11).max(20),
      password: z.string().min(1).max(256),
      orgSlug: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
    }).parse(body);
    const r = await this.auth.loginPassword(cpf, password, clientIp(req) ?? undefined, req.headers["user-agent"] ?? undefined, orgSlug);
    setCookie(reply, r.rawToken, r.expiresAt);
    return { ok: true, mustReset: r.mustReset };
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const env = loadEnv();
    const token = req.cookies?.[env.EMPLOYEE_COOKIE_NAME];
    if (token) await this.auth.logout(token);
    reply.clearCookie(env.EMPLOYEE_COOKIE_NAME, { domain: env.SESSION_COOKIE_DOMAIN, path: "/" });
    return;
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("set-password")
  @HttpCode(200)
  async setPassword(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown) {
    const { password } = z.object({ password: z.string().min(8).max(256) }).parse(body);
    return this.auth.setPassword(ctx, password);
  }

  // ===== ÁREA AUTENTICADA =====
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("me")
  async me(@CurrentEmployee() ctx: EmployeeContext) {
    return this.portal.me(ctx);
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Patch("profile")
  async updateProfile(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown) {
    const input = z.object({
      phone: z.string().max(30).nullable().optional(),
      whatsappPhone: z.string().max(30).nullable().optional(),
      email: z.string().email().nullable().optional(),
      photoUrl: z.string().url().nullable().optional(),
      addressLine: z.string().max(200).nullable().optional(),
      addressNumber: z.string().max(20).nullable().optional(),
      addressComplement: z.string().max(80).nullable().optional(),
      neighborhood: z.string().max(80).nullable().optional(),
      city: z.string().max(80).nullable().optional(),
      state: z.string().length(2).nullable().optional(),
      postalCode: z.string().max(12).nullable().optional(),
    }).parse(body);
    return this.portal.updateProfile(ctx, input);
  }

  // ---- ponto ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("clock")
  @HttpCode(201)
  async clock(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = z.object({
      kind: z.enum(["in", "out", "break_in", "break_out", "snack_out", "snack_in"]),
      selfieUrl: z.string().url().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
      accuracyM: z.number().nullable().optional(),
    }).parse(body);
    return this.portal.clockIn(ctx, { ...input, ip: clientIp(req) });
  }

  /** Bate o ponto no novo sistema (REP-A), vinculado ao funcionário do RH. */
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("ponto/punch")
  @HttpCode(200)
  async pontoPunch(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = z.object({
      lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), accuracy: z.number().nullable().optional(),
    }).parse(body ?? {});
    return this.ponto.punchByHrEmployee(ctx.organizationId, ctx.employeeId, {
      lat: input.lat ?? undefined, lng: input.lng ?? undefined, accuracy: input.accuracy ?? undefined,
    }, clientIp(req));
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Get("time-entries")
  async timeEntries(@CurrentEmployee() ctx: EmployeeContext, @Req() req: FastifyRequest) {
    const q = req.query as any;
    return { items: await this.portal.myTimeEntries(ctx, { from: q?.from, to: q?.to }) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Get("time-sheets")
  async timeSheets(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myTimeSheets(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("time-sheets/:id/sign")
  @HttpCode(200)
  async signSheet(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { signatureImageUrl } = z.object({ signatureImageUrl: z.string().url() }).parse(body);
    return { sheet: await this.portal.signTimeSheet(ctx, id, { signatureImageUrl, ip: clientIp(req) }) };
  }

  /** PDF do espelho de ponto (branded) pro funcionário baixar/imprimir. */
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("time-sheets/:id/sheet")
  async sheetHtml(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.portal.timeSheetHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  // ---- holerite ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("payslips")
  async payslips(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myPayslips(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("payslips/:id/acknowledge")
  @HttpCode(200)
  async acknowledge(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = z.object({ signatureImageUrl: z.string().url().nullable().optional() }).parse(body ?? {});
    return this.portal.acknowledgePayslip(ctx, id, { signatureImageUrl: input.signatureImageUrl ?? null, ip: clientIp(req) });
  }

  // ---- solicitações ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("requests")
  async requests(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myRequests(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("requests")
  @HttpCode(201)
  async createRequest(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown) {
    const input = z.object({
      kind: z.enum(["vacation", "advance", "shift_swap", "absence_justify", "expense"]),
      payload: z.record(z.unknown()).optional(),
      amountCents: z.number().int().min(0).nullable().optional(),
      attachmentUrl: z.string().url().nullable().optional(),
    }).parse(body);
    return { request: await this.portal.createRequest(ctx, input) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("requests/:id/cancel")
  @HttpCode(200)
  async cancelRequest(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string) {
    return { request: await this.portal.cancelRequest(ctx, id) };
  }

  /** Trocas de horário em que sou o colega e preciso aceitar (duplo aceite). */
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("swaps-to-accept")
  async swapsToAccept(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.swapsToAccept(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("swaps/:id/decide")
  @HttpCode(200)
  async decideSwap(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Body() body: unknown) {
    const { accept } = z.object({ accept: z.boolean() }).parse(body);
    return { request: await this.portal.decideSwap(ctx, id, accept) };
  }

  // ---- colegas (troca de horário) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("coworkers")
  async coworkers(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.coworkers(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Get("coworkers/:id/shifts")
  async coworkerShifts(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    const date = String((req.query as any)?.date ?? "");
    if (!date) return { items: [] };
    return { items: await this.portal.coworkerShifts(ctx, id, date) };
  }

  // ---- ponto: pedir edição ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("time-entries/:id/request-edit")
  @HttpCode(200)
  async requestTimeEdit(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ requestedTo: z.string(), reason: z.string().min(2).max(300) }).parse(body);
    return { entry: await this.portal.requestTimeEdit(ctx, id, input) };
  }

  // ---- ponto: espelho do mês + justificativas (falta/esqueceu/atestado) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("attendance")
  async attendance(@CurrentEmployee() ctx: EmployeeContext, @Req() req: FastifyRequest) {
    const month = String((req.query as any)?.month ?? new Date().toISOString().slice(0, 7));
    return this.portal.attendanceMonth(ctx, month);
  }
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("justifications")
  async justifications(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.listJustifications(ctx) };
  }
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("justifications")
  @HttpCode(201)
  async createJustification(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown) {
    const input = z.object({
      refDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      kind: z.enum(["forgot_punch", "medical", "other"]),
      proposed: z.record(z.string()).nullable().optional(),
      attachmentUrl: z.string().url().nullable().optional(),
      daysCount: z.number().int().min(1).max(60).optional(),
      note: z.string().max(500).nullable().optional(),
    }).parse(body);
    return { justification: await this.portal.createJustification(ctx, input) };
  }

  // ---- empréstimos ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("loans")
  async loans(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myLoans(ctx) };
  }

  // ---- banco de horas (extrato) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("bank")
  async bank(@CurrentEmployee() ctx: EmployeeContext) {
    return this.portal.myBank(ctx);
  }

  // ---- espelho assinado ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("espelho/signature")
  async espelhoSig(@CurrentEmployee() ctx: EmployeeContext, @Req() req: FastifyRequest) {
    const month = String((req.query as any)?.month ?? "");
    // Devolve { signature, closing, canSign } — front usa `canSign` pra
    // mostrar/esconder o botão "Assinar espelho" e `closing.status` pra
    // explicar pro usuário por que não dá pra assinar mês aberto.
    return this.portal.myEspelhoSignature(ctx, month);
  }
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("espelho/sign")
  @HttpCode(200)
  async signEspelho(@CurrentEmployee() ctx: EmployeeContext, @Body() b: any, @Req() req: FastifyRequest) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    return this.portal.signMyEspelho(ctx, String(b?.month ?? ""), { signatureImageUrl: b?.signatureImageUrl ?? null, ip });
  }
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("espelho/pdf")
  async espelhoPdf(@CurrentEmployee() ctx: EmployeeContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const month = String((req.query as any)?.month ?? "");
    const { buffer, filename } = await this.portal.myEspelhoPdf(ctx, month);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ---- férias (saldo + lista) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("vacations")
  async vacations(@CurrentEmployee() ctx: EmployeeContext) {
    return this.portal.myVacations(ctx);
  }

  // ---- exames ocupacionais (ASO) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("exams")
  async exams(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myExams(ctx) };
  }

  // ---- treinamentos / certificações ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("trainings")
  async trainings(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myTrainings(ctx) };
  }

  // ---- advertências (ciência) ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("warnings")
  async warnings(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myWarnings(ctx) };
  }
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("warnings/:id/acknowledge")
  @HttpCode(200)
  async ackWarning(@CurrentEmployee() ctx: EmployeeContext, @Param("id") id: string, @Body() b: any) {
    return this.portal.acknowledgeWarning(ctx, id, { signatureImageUrl: b?.signatureImageUrl ?? null });
  }

  // ---- comissões ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("commissions")
  async commissions(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myCommissions(ctx) };
  }

  // ---- documentos ----
  @Public()
  @UseGuards(EmployeeGuard)
  @Get("documents")
  async documents(@CurrentEmployee() ctx: EmployeeContext) {
    return { items: await this.portal.myDocuments(ctx) };
  }

  @Public()
  @UseGuards(EmployeeGuard)
  @Post("documents")
  @HttpCode(201)
  async addDoc(@CurrentEmployee() ctx: EmployeeContext, @Body() body: unknown) {
    const input = z.object({ docType: z.string().max(40), title: z.string().max(200).nullable().optional(), fileUrl: z.string().url() }).parse(body);
    return { document: await this.portal.addOwnDocument(ctx, input) };
  }

  /** Upload (selfie do ponto, foto, documento). Privado por padrão (geo/selfie do ponto vai público p/ render simples). */
  @Public()
  @UseGuards(EmployeeGuard)
  @Post("upload")
  async upload(@CurrentEmployee() ctx: EmployeeContext, @Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) throw new AppError(ErrorCode.ValidationFailed, `Tipo não permitido: ${mime}`, 400);
    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Arquivo vazio", 400);
    if (buffer.length > MAX_BYTES) throw new AppError(ErrorCode.ValidationFailed, "Arquivo muito grande (máx 10MB)", 413);

    const isPrivate = String((req.query as any)?.private ?? "") === "1";
    if (isPrivate) {
      const { key } = await this.storage.putPrivate({
        keyPrefix: `hr/${ctx.organizationId}/${ctx.employeeId}`, contentType: mime, body: buffer, originalName: data.filename,
      });
      return { ok: true, url: `priv:${key}`, key };
    }
    const { url, key } = await this.storage.putPublic({
      keyPrefix: `employees/${ctx.employeeId}`, contentType: mime, body: buffer, originalName: data.filename,
    });
    return { ok: true, url, key };
  }
}
