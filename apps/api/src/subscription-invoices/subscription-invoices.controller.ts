import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePlatformAdmin } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { SubscriptionInvoicesService } from "./subscription-invoices.service";

const NF_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

@Controller("subscription-invoices")
export class SubscriptionInvoicesController {
  constructor(private readonly svc: SubscriptionInvoicesService, private readonly storage: StorageService) {}

  /** Mensalidades da empresa logada. */
  @Get("mine")
  async mine(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listMine(ctx) };
  }

  /** Financeiro do master: todas as mensalidades. */
  @RequirePlatformAdmin()
  @Get("admin")
  async all(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.listAll(ctx, { status }) };
  }

  @RequirePlatformAdmin()
  @Post()
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { invoice: await this.svc.create(ctx, body) };
  }

  /** Gera as mensalidades do mês (manual) — idempotente. */
  @RequirePlatformAdmin()
  @Post("generate")
  @HttpCode(200)
  async generate(@Body() body: any) {
    const competence = typeof body?.competence === "string" && /^\d{4}-\d{2}$/.test(body.competence) ? body.competence : undefined;
    return this.svc.generateMonthlyInvoices(competence);
  }

  /** Roda a régua de cobrança agora (manual). */
  @RequirePlatformAdmin()
  @Post("run-dunning")
  @HttpCode(200)
  async runDunning() {
    return this.svc.runDunning();
  }

  @RequirePlatformAdmin()
  @Patch(":id/paid")
  async markPaid(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: any) {
    return { invoice: await this.svc.markPaid(ctx, id, body ?? {}) };
  }

  @RequirePlatformAdmin()
  @Delete(":id")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.remove(ctx, id);
  }

  /** Master sobe a nota fiscal da mensalidade (PDF/imagem). */
  @RequirePlatformAdmin()
  @Post(":id/nf")
  async uploadNf(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!NF_MIME.has(mime)) throw new AppError(ErrorCode.ValidationFailed, `Tipo não permitido: ${mime}`, 400);
    const buffer = await data.toBuffer();
    if (buffer.length > 15 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 15MB", 413);
    const { url } = await this.storage.putPublic({ keyPrefix: `subscriptions/${id}/nf`, contentType: mime || "application/pdf", body: buffer, originalName: data.filename });
    return { invoice: await this.svc.attachNf(ctx, id, url) };
  }

  /** Empresa paga a mensalidade (Pix/cartão) via Mercado Pago da plataforma. */
  @Post(":id/pay")
  @HttpCode(200)
  async pay(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ method: z.enum(["pix", "card"]) }).parse(body);
    return this.svc.startPayment(ctx, id, input.method);
  }

  /** Recibo (PDF) — empresa dona ou master. */
  @Get(":id/receipt")
  async receipt(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.svc.receiptPdf(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
}
