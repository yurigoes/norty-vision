import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { Public } from "../auth/decorators";
import { loadEnv } from "../config";
import { StorageService } from "../storage/storage.service";
import { CustomerAuthService } from "./customer-auth.service";
import { CustomerPortalService } from "./customer-portal.service";
import { CustomerGuard } from "./customer.guard";
import { CurrentCustomer, type CustomerContext } from "./customer-context";
import { ContractsService } from "../contracts/contracts.service";
import { ProductionService } from "../production/production.service";

const ALLOWED_UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SignContractSchema = z.object({
  signatureImageUrl: z.string().url(),
  selfieUrl: z.string().url().optional(),
  fieldValues: z.record(z.unknown()).optional(),
});

const OrgSlug = z.string().regex(/^[a-z0-9-]{3,40}$/).optional();
const RequestCodeSchema = z.object({ document: z.string().min(11).max(20), orgSlug: OrgSlug });
const VerifyCodeSchema = z.object({
  document: z.string().min(11).max(20),
  code: z.string().length(6),
  orgSlug: OrgSlug,
});
// Login por telefone+OTP (alternativa ao CPF — mais amigável: cliente não quer dar CPF)
const PhoneSchema = z.string().regex(/^\+?\d[\d\s().-]{8,18}$/, "Telefone inválido");
const RequestCodePhoneSchema = z.object({ phone: PhoneSchema, orgSlug: OrgSlug });
const VerifyCodePhoneSchema = z.object({
  phone: PhoneSchema,
  code: z.string().length(6),
  orgSlug: OrgSlug,
});
const PasswordLoginSchema = z.object({
  document: z.string().min(11).max(20),
  password: z.string().min(1).max(256),
  orgSlug: OrgSlug,
});
const SetPasswordSchema = z.object({ password: z.string().min(8).max(256) });

const ProfileSchema = z.object({
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  whatsappPhone: z.string().max(30).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  postalCode: z.string().max(12).nullable().optional(),
  addressLine: z.string().max(200).nullable().optional(),
  addressNumber: z.string().max(20).nullable().optional(),
  addressComplement: z.string().max(80).nullable().optional(),
  neighborhood: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const ApplicationSchema = z.object({
  incomeCents: z.number().int().min(0),
  requestedLimitCents: z.number().int().min(0),
  documents: z.array(z.object({
    docType: z.enum(["id_front", "id_back", "proof_residence", "selfie_holding_id", "income_proof"]),
    fileUrl: z.string().url(),
  })).min(1),
});

function setCookie(reply: FastifyReply, token: string, expires: Date) {
  const env = loadEnv();
  reply.setCookie(env.CUSTOMER_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    domain: env.SESSION_COOKIE_DOMAIN,
    path: "/",
    expires,
  });
}

@Controller("portal")
export class CustomerPortalController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly portal: CustomerPortalService,
    private readonly storage: StorageService,
    private readonly contracts: ContractsService,
    private readonly production: ProductionService,
  ) {}

  // ===== AUTH (publico) =====
  @Public()
  @Post("auth/request-code")
  @HttpCode(200)
  async requestCode(@Body() body: unknown) {
    const { document, orgSlug } = RequestCodeSchema.parse(body);
    return this.auth.requestCode(document, orgSlug);
  }

  @Public()
  @Post("auth/verify-code")
  @HttpCode(200)
  async verifyCode(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { document, code, orgSlug } = VerifyCodeSchema.parse(body);
    const r = await this.auth.verifyCode(document, code, req.ip, req.headers["user-agent"] ?? undefined, orgSlug);
    setCookie(reply, r.rawToken, r.expiresAt);
    return { ok: true, expiresAt: r.expiresAt.toISOString() };
  }

  /** Login por TELEFONE + OTP via WhatsApp (alternativa preferida ao CPF —
   *  cliente comum prefere não informar CPF pra ver pedido). Sessão tokenizada
   *  igual ao login por CPF: ao expirar, cai de volta no login. */
  @Public()
  @Post("auth/request-code-phone")
  @HttpCode(200)
  async requestCodePhone(@Body() body: unknown) {
    const { phone, orgSlug } = RequestCodePhoneSchema.parse(body);
    return this.auth.requestCodeByPhone(phone, orgSlug);
  }

  @Public()
  @Post("auth/verify-code-phone")
  @HttpCode(200)
  async verifyCodePhone(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { phone, code, orgSlug } = VerifyCodePhoneSchema.parse(body);
    const r = await this.auth.verifyCodeByPhone(phone, code, req.ip, req.headers["user-agent"] ?? undefined, orgSlug);
    setCookie(reply, r.rawToken, r.expiresAt);
    return { ok: true, expiresAt: r.expiresAt.toISOString() };
  }

  @Public()
  @Post("auth/login-password")
  @HttpCode(200)
  async loginPassword(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { document, password, orgSlug } = PasswordLoginSchema.parse(body);
    const r = await this.auth.loginPassword(document, password, req.ip, req.headers["user-agent"] ?? undefined, orgSlug);
    setCookie(reply, r.rawToken, r.expiresAt);
    return { ok: true, expiresAt: r.expiresAt.toISOString(), mustReset: (r as any).mustReset ?? false };
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const env = loadEnv();
    const token = req.cookies?.[env.CUSTOMER_COOKIE_NAME];
    if (token) await this.auth.logout(token);
    reply.clearCookie(env.CUSTOMER_COOKIE_NAME, { domain: env.SESSION_COOKIE_DOMAIN, path: "/" });
    return;
  }

  // ===== AREA AUTENTICADA =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("me")
  async me(@CurrentCustomer() ctx: CustomerContext) {
    return this.portal.me(ctx);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Patch("profile")
  async updateProfile(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    return { customer: await this.portal.updateProfile(ctx, ProfileSchema.parse(body)) };
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("set-password")
  @HttpCode(200)
  async setPassword(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    return this.auth.setPassword(ctx, SetPasswordSchema.parse(body).password);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("credit-application")
  @HttpCode(201)
  async apply(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    return { application: await this.portal.createApplication(ctx, ApplicationSchema.parse(body)) };
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Get("credit-applications")
  async applications(@CurrentCustomer() ctx: CustomerContext) {
    return this.portal.listApplications(ctx);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("limit-request")
  @HttpCode(201)
  async limitRequest(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    const input = z.object({
      requestedLimitCents: z.number().int().positive(),
      reason: z.string().max(500).nullable().optional(),
    }).parse(body);
    return { request: await this.portal.requestLimitIncrease(ctx, input.requestedLimitCents, input.reason ?? null) };
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Get("documents")
  async documents(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.portal.listDocuments(ctx) };
  }

  /** NPS espontâneo: o cliente avalia a experiência a qualquer momento. */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("nps")
  @HttpCode(200)
  async submitNps(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    const input = z.object({
      npsScore: z.number().int().min(0).max(10),
      comment: z.string().max(1000).nullable().optional(),
    }).parse(body);
    return this.portal.submitNps(ctx, input);
  }

  /** Cliente paga uma parcela: gera Pix (QR) ou link de cartão no MP da empresa. */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("installments/:id/pay")
  @HttpCode(200)
  async payInstallment(
    @CurrentCustomer() ctx: CustomerContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ method: z.enum(["pix", "card", "infinitepay"]) }).parse(body);
    return this.portal.payInstallment(ctx, id, input.method);
  }

  /** Autorefresh do Pix: o portal consulta o status da parcela no MP. */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("installments/:id/check")
  @HttpCode(200)
  async checkInstallment(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string) {
    return this.portal.checkInstallmentStatus(ctx, id);
  }

  // ===== Cartão salvo (cobrança automática do crediário) =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("credit-card")
  async cardStatus(@CurrentCustomer() ctx: CustomerContext) {
    return this.portal.getCardStatus(ctx);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("credit-card")
  @HttpCode(200)
  async saveCard(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    const input = z.object({
      cardToken: z.string().min(8).max(200),
      last4: z.string().max(4).optional(),
      brand: z.string().max(40).optional(),
      pmId: z.string().max(40).optional(),
    }).parse(body);
    return this.portal.saveCreditCard(ctx, input);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("credit-card/remove")
  @HttpCode(200)
  async removeCard(@CurrentCustomer() ctx: CustomerContext) {
    return this.portal.removeCreditCard(ctx);
  }

  // ===== Chamados (helpdesk) =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("tickets")
  async myTickets(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.portal.listMyTickets(ctx) };
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Get("help")
  async myHelp(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.portal.listMyHelp(ctx) };
  }

  // ===== ordens de serviço (tempo real) =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("service-orders")
  async myServiceOrders(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.portal.listMyServiceOrders(ctx) };
  }
  @Public()
  @UseGuards(CustomerGuard)
  @Get("service-orders/:id")
  async myServiceOrder(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest) {
    return this.portal.getMyServiceOrder(ctx, (req.params as any).id);
  }
  @Public()
  @UseGuards(CustomerGuard)
  @Post("service-orders/:id/rate")
  @HttpCode(200)
  async rateServiceOrder(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() }).parse(body);
    return this.portal.rateMyServiceOrder(ctx, (req.params as any).id, input.rating, input.comment);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Get("tickets/:id")
  async myTicket(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest) {
    return this.portal.getMyTicket(ctx, (req.params as any).id);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("tickets")
  @HttpCode(200)
  async openTicket(@CurrentCustomer() ctx: CustomerContext, @Body() body: unknown) {
    const input = z.object({
      subject: z.string().min(2).max(160),
      description: z.string().min(2).max(5000),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }).parse(body);
    return this.portal.openTicket(ctx, input);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("tickets/:id/reply")
  @HttpCode(200)
  async replyTicket(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ body: z.string().min(1).max(5000) }).parse(body);
    return this.portal.replyMyTicket(ctx, (req.params as any).id, input.body);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("tickets/:id/confirm-close")
  @HttpCode(200)
  async confirmCloseTicket(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = z.object({
      satisfied: z.boolean(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().max(2000).optional(),
    }).parse(body);
    return this.portal.confirmCloseMyTicket(ctx, (req.params as any).id, input);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("lens-orders/:id/confirm-delivery")
  @HttpCode(200)
  async confirmLensDelivery(
    @CurrentCustomer() ctx: CustomerContext,
    @Req() req: FastifyRequest,
  ) {
    const id = (req.params as any).id;
    await this.portal.confirmLensDelivery(ctx, id, req.ip ?? null);
    return { ok: true };
  }

  /** Comprovante de entrega (HTML) pro cliente baixar/imprimir. */
  @Public()
  @UseGuards(CustomerGuard)
  @Get("lens-orders/:id/receipt")
  async lensReceipt(
    @CurrentCustomer() ctx: CustomerContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = (req.params as any).id;
    const html = await this.portal.deliveryReceiptHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  /** Upload de documento/selfie/avatar pelo cliente (multipart). */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("upload")
  async upload(@CurrentCustomer() ctx: CustomerContext, @Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!ALLOWED_UPLOAD_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Arquivo vazio", 400);
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(ErrorCode.ValidationFailed, "Arquivo muito grande (max 10MB)", 413);
    }
    // documentos sensíveis (KYC) vão pro bucket PRIVADO; servidos só via
    // endpoint autenticado. A "url" volta como "priv:<key>" e é guardada
    // transparentemente no fileUrl do documento.
    const isPrivate = String((req.query as any)?.private ?? "") === "1";
    if (isPrivate) {
      const { key } = await this.storage.putPrivate({
        keyPrefix: `kyc/${ctx.organizationId}/${ctx.customerId}`,
        contentType: mime,
        body: buffer,
        originalName: data.filename,
      });
      return { ok: true, url: `priv:${key}`, key };
    }
    const { url, key } = await this.storage.putPublic({
      keyPrefix: `customers/${ctx.customerId}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    return { ok: true, url, key };
  }

  // ===== PEDIDOS DE PRODUÇÃO (aprovação de arte) =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("production-orders")
  async myProductionOrders(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.production.portalList(ctx.organizationId, ctx.customerId) };
  }
  @Public()
  @UseGuards(CustomerGuard)
  @Get("production-orders/:id")
  async myProductionOrder(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string) {
    return { order: await this.production.portalGet(ctx.organizationId, ctx.customerId, id) };
  }
  /** Cliente sobe um arquivo (logo etc.) do pedido. */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("production-orders/:id/files")
  async myProductionUpload(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Arquivo vazio", 400);
    if (buffer.length > 25 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo muito grande (max 25MB)", 413);
    const { url } = await this.storage.putPublic({ keyPrefix: `production/${id}/client_asset`, contentType: mime || "application/octet-stream", body: buffer, originalName: data.filename });
    const file = await this.production.portalAddFile(ctx.organizationId, ctx.customerId, id, { url, name: data.filename });
    return { ok: true, file };
  }
  /** Cliente aprova/reprova a arte (reprovar exige comentário). */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("production-orders/:id/art-review")
  @HttpCode(200)
  async myProductionReview(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(1000).nullable().optional() }).parse(body);
    return { order: await this.production.portalReviewArt(ctx.organizationId, ctx.customerId, id, input) };
  }

  /** Cliente preenche a lista (roster) padronizada — nome / nº / tamanho / qtd
   *  diretamente do portal, sem precisar mandar no WhatsApp. Substitui o
   *  roster inteiro (não merge); o front envia todas as linhas. */
  @Public()
  @UseGuards(CustomerGuard)
  @Patch("production-orders/:id/roster")
  @HttpCode(200)
  async myProductionRoster(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ rows: z.array(z.object({
      playerName: z.string().min(1).max(120),
      number: z.string().max(10).nullable().optional(),
      size: z.string().max(20).nullable().optional(),
      modelKey: z.string().max(40).nullable().optional(),
      qty: z.number().int().min(1).max(1000).optional(),
      notes: z.string().max(300).nullable().optional(),
    })).min(1).max(500) }).parse(body);
    return { roster: await this.production.portalSetRoster(ctx.organizationId, ctx.customerId, id, input.rows) };
  }

  /** Cliente assina a OS na finalização (PNG do canvas, sem certificado). */
  @Public()
  @UseGuards(CustomerGuard)
  @Post("production-orders/:id/customer-signature")
  @HttpCode(200)
  async myProductionSign(@CurrentCustomer() ctx: CustomerContext, @Param("id") id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = z.object({ signatureDataUrl: z.string().min(50).startsWith("data:image/") }).parse(body);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    return { order: await this.production.portalSignOrder(ctx.organizationId, ctx.customerId, id, input.signatureDataUrl, ip) };
  }

  /** Serve um documento privado do próprio cliente (autenticado). */
  @Public()
  @UseGuards(CustomerGuard)
  @Get("documents/file")
  async privateFile(
    @CurrentCustomer() ctx: CustomerContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const key = String((req.query as any)?.key ?? "");
    // só pode acessar arquivos do próprio cliente (prefixo kyc/<org>/<customer>)
    const allowedPrefix = `kyc/${ctx.organizationId}/${ctx.customerId}/`;
    if (!key.startsWith(allowedPrefix)) {
      throw new AppError(ErrorCode.Forbidden, "Acesso negado", 403);
    }
    const { body, contentType } = await this.storage.getPrivate(key);
    reply.type(contentType).send(body);
  }

  // ===== CONTRATOS (crediario) =====
  @Public()
  @UseGuards(CustomerGuard)
  @Get("contracts")
  async contractsList(@CurrentCustomer() ctx: CustomerContext) {
    return { items: await this.contracts.listForCustomer(ctx.customerId ?? null, ctx.creditAccountId ?? null) };
  }

  /** Contrato (HTML branded com selo) pro cliente baixar/imprimir. */
  @Public()
  @UseGuards(CustomerGuard)
  @Get("contracts/:id/html")
  async contractHtml(
    @CurrentCustomer() ctx: CustomerContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = (req.params as any).id;
    const html = await this.contracts.renderHtmlForCustomer(ctx.customerId ?? null, ctx.creditAccountId ?? null, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  @Public()
  @UseGuards(CustomerGuard)
  @Post("contracts/:id/sign")
  @HttpCode(200)
  async signContract(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const input = SignContractSchema.parse(body);
    const contractId = (req.params as any).id;
    if (!ctx.creditAccountId && !ctx.customerId) {
      throw new AppError(ErrorCode.ValidationFailed, "Sessão sem cliente vinculado", 400);
    }
    const signed = await this.contracts.signBiometric({
      contractId,
      creditAccountId: ctx.creditAccountId ?? null,
      customerId: ctx.customerId ?? null,
      signatureImageUrl: input.signatureImageUrl,
      selfieUrl: input.selfieUrl ?? null,
      fieldValues: input.fieldValues,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    return { contract: { id: signed.id, status: signed.status, signedAt: signed.signedAt } };
  }
}
