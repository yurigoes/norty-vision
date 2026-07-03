import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { OpticalService } from "./optical.service";

const EXAM_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

const OrderSchema = z.object({
  storeId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional()),
  customerId: z.string().uuid().nullable().optional(),
  saleId: z.string().uuid().nullable().optional(),
  doctorSupplierId: z.string().uuid().nullable().optional(),
  labSupplierId: z.string().uuid().nullable().optional(),
  prescription: z.record(z.unknown()).optional(),
  examAttachmentUrl: z.string().url().nullable().optional(),
  customerPriceCents: z.number().int().min(0).nullable().optional(),
  labCostCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sellerUserId: z.string().uuid().nullable().optional(),
  productDescription: z.string().max(2000).nullable().optional(),
  productPhotoUrl: z.string().url().nullable().optional(),
  frameProductId: z.string().uuid().nullable().optional(),
  lensProductId: z.string().uuid().nullable().optional(),
  osNumber: z.string().max(60).nullable().optional(),
});

const InvoiceSchema = z.object({
  nfNumber: z.string().max(60).nullable().optional(),
  nfUrl: z.string().url(),
});

const BatchSchema = z.object({
  labSupplierId: z.string().uuid().nullable().optional(),
  orderIds: z.array(z.string().uuid()).min(1),
  courierUserId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const ConferSchema = z.object({
  arrived: z.array(z.string().uuid()).default([]),
  late: z.array(z.object({ orderId: z.string().uuid(), expectedAt: z.string().nullable().optional() })).optional(),
});

@Controller("optical")
export class OpticalController {
  constructor(
    private readonly svc: OpticalService,
    private readonly storage: StorageService,
  ) {}

  /** Upload direto do exame (sem link). Anexa ao pedido. */
  @Post("orders/:id/exam")
  @HttpCode(200)
  @RequirePermission("lens.orders")
  async uploadExam(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!EXAM_MIME.has(mime)) throw new AppError(ErrorCode.ValidationFailed, `Tipo não permitido: ${mime}`, 400);
    const buffer = await data.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 10MB", 413);
    const { url } = await this.storage.putPublic({
      keyPrefix: `optical/${ctx.orgId}/${id}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    await this.svc.updateOrder(ctx, id, { examAttachmentUrl: url });
    return { ok: true, url };
  }

  // ---- pedidos ----
  @Get("orders")
  @RequirePermission("lens.orders")
  async listOrders(
    @CurrentContext() ctx: RequestContext,
    @Query("status") status?: string,
    @Query("batchId") batchId?: string,
  ) {
    return { items: await this.svc.listOrders(ctx, { status, batchId }) };
  }

  /** Vendas pagas do cliente, p/ o pedido de lente puxar e auto-preencher. */
  @Get("eligible-sales")
  @RequirePermission("lens.orders")
  async eligibleSales(@CurrentContext() ctx: RequestContext, @Query("customerId") customerId: string) {
    return { items: await this.svc.eligibleSales(ctx, customerId) };
  }

  @Get("orders/:id")
  @RequirePermission("lens.orders")
  async getOrder(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { order: await this.svc.getOrder(ctx, id) };
  }

  @Post("orders")
  @HttpCode(201)
  @RequirePermission("lens.orders")
  async createOrder(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { order: await this.svc.createOrder(ctx, OrderSchema.parse(body)) };
  }

  @Patch("orders/:id")
  @RequirePermission("lens.orders")
  async updateOrder(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { order: await this.svc.updateOrder(ctx, id, OrderSchema.partial().parse(body)) };
  }

  @Post("orders/:id/arrived")
  @HttpCode(200)
  @RequirePermission("lens.orders")
  async arrived(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { order: await this.svc.markArrived(ctx, id) };
  }

  @Post("orders/:id/notify")
  @HttpCode(200)
  @RequirePermission("lens.orders")
  async notify(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { order: await this.svc.notifyArrival(ctx, id) };
  }

  @Post("orders/:id/deliver")
  @HttpCode(200)
  @RequirePermission("lens.orders")
  async deliver(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { order: await this.svc.deliver(ctx, id) };
  }

  @Post("orders/:id/invoice")
  @HttpCode(200)
  @RequirePermission("lens.orders")
  async invoice(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { order: await this.svc.attachInvoice(ctx, id, InvoiceSchema.parse(body)) };
  }

  // ---- lotes ----
  @Get("batches")
  @RequirePermission("lens.batches")
  async listBatches(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.listBatches(ctx, { status }) };
  }

  @Post("batches")
  @HttpCode(201)
  @RequirePermission("lens.batches")
  async createBatch(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { batch: await this.svc.createBatch(ctx, BatchSchema.parse(body)) };
  }

  @Post("batches/:id/confer")
  @HttpCode(200)
  @RequirePermission("lens.batches")
  async confer(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.conferBatch(ctx, id, ConferSchema.parse(body));
  }

  @Get("batches/:id/sheet")
  @RequirePermission("lens.batches")
  async sheet(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.batchHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }
}
