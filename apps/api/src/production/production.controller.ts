import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { ProductionService } from "./production.service";
import { ProductionImportService } from "./production-import.service";
import { ProductionWipeService, type WipeScope } from "./production-wipe.service";

const ItemSchema = z.object({ description: z.string().min(1).max(300), qty: z.number().int().min(1).max(100000), unitPriceCents: z.number().int().min(0) });
const UpsertSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  contactName: z.string().min(1).max(200),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  storeId: z.string().uuid().nullable().optional(),
  delivery: z.boolean().optional(),
  dueDate: z.string().nullable().optional(),
  downPaymentCents: z.number().int().min(0).optional(),
  paymentStatus: z.enum(["none", "partial", "paid"]).optional(),
  paymentMethod: z.string().max(40).nullable().optional(),
  needsInvoice: z.boolean().optional(),
  fiscalCpf: z.string().max(20).nullable().optional(),
  fiscalAddress: z.string().max(300).nullable().optional(),
  fiscalBirthDate: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  discountCents: z.number().int().min(0).optional(),
  discountAuthRequestId: z.string().uuid().nullable().optional(),
  discountAuthCode: z.string().max(8).nullable().optional(),
  items: z.array(ItemSchema).min(1),
});

const FILE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "application/postscript", "application/illustrator", "application/zip", "application/x-zip-compressed", "application/octet-stream"]);

@Controller("production")
export class ProductionController {
  constructor(private readonly svc: ProductionService, private readonly storage: StorageService, private readonly importSvc: ProductionImportService, private readonly wipeSvc: ProductionWipeService) {}

  /** LIMPEZA da base antes do import — requer admin/owner + confirmação por slug. */
  @Post("wipe-data")
  @HttpCode(200)
  async wipeData(@CurrentContext() ctx: RequestContext, @Body() body: { confirmSlug: string; scope: WipeScope }) {
    const input = z.object({
      confirmSlug: z.string().min(2).max(80),
      scope: z.object({
        production: z.boolean().optional(),
        quotes: z.boolean().optional(),
        conversations: z.boolean().optional(),
        leads: z.boolean().optional(),
        appointments: z.boolean().optional(),
        credit: z.boolean().optional(),
        lens: z.boolean().optional(),
        broadcast: z.boolean().optional(),
        customers: z.boolean().optional(),
      }),
    }).parse(body ?? {});
    return this.wipeSvc.wipe(ctx, input);
  }

  /** Pré-visualiza .xlsx (dry-run). Multipart 'file'. */
  @Post("import/preview")
  @HttpCode(200)
  @RequirePermission("production.create")
  async importPreview(@Req() req: FastifyRequest) {
    const file = await (req as any).file();
    if (!file) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const buf = await file.toBuffer();
    if (buf.length > 25 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 25MB", 413);
    return this.importSvc.preview(buf, 15);
  }

  /** Importa .xlsx para production_order (idempotente). */
  @Post("import/run")
  @HttpCode(200)
  @RequirePermission("production.create")
  async importRun(@CurrentContext() ctx: RequestContext, @Req() req: FastifyRequest) {
    await this.svc.assertSubmodule(ctx, "import");
    const file = await (req as any).file();
    if (!file) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const buf = await file.toBuffer();
    if (buf.length > 25 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 25MB", 413);
    // option vem via field (multipart) ou query
    const fields = (file.fields ?? {}) as Record<string, { value?: string }>;
    const createMissing = fields.createCostureiraIfMissing?.value !== "false";
    return this.importSvc.importBuffer(ctx, buf, { createCostureiraIfMissing: createMissing });
  }

  @Get()
  async list(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.list(ctx, { status }) };
  }
  @Get("kanban")
  async kanban(@CurrentContext() ctx: RequestContext) {
    return this.svc.designKanban(ctx);
  }
  @Get("financeiro")
  async financeiro(@CurrentContext() ctx: RequestContext, @Query("start") start?: string, @Query("end") end?: string) {
    return this.svc.financeiro(ctx, { start, end });
  }
  @Get("financeiro/export")
  async financeiroExport(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("format") format?: string, @Query("start") start?: string, @Query("end") end?: string) {
    const fmt = format === "pdf" ? "pdf" : "csv";
    const { buffer, filename, contentType } = await this.svc.financeiroExport(ctx, { start, end, format: fmt });
    reply.type(contentType).header("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
  }
  // ---------------- Lotes ----------------
  @Get("batches")
  async listBatches(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listBatches(ctx) };
  }
  @Post("batches")
  @HttpCode(201)
  async createBatch(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    await this.svc.assertSubmodule(ctx, "lotes");
    const input = z.object({ name: z.string().min(1).max(120), storeId: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional(), orderIds: z.array(z.string().uuid()).optional() }).parse(body);
    return { batch: await this.svc.createBatch(ctx, input) };
  }
  @Patch("batches/:id/orders")
  async setBatchOrders(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ orderIds: z.array(z.string().uuid()) }).parse(body);
    return this.svc.setBatchOrders(ctx, id, input.orderIds);
  }
  @Patch("batches/:id/status")
  async setBatchStatus(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string }) {
    return { batch: await this.svc.setBatchStatus(ctx, id, b?.status) };
  }
  @Delete("batches/:id")
  async removeBatch(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.removeBatch(ctx, id);
  }
  @Get("nf/pending")
  async nfPending(@CurrentContext() ctx: RequestContext) {
    return this.svc.nfPending(ctx);
  }
  // ---------------- Cancelamento / estorno ----------------
  @Get("cancel-requests")
  async cancelRequests(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listCancelRequests(ctx) };
  }
  /** Registra o estorno (com comprovante) e cancela o pedido + a NFS-e vinculada. */
  @Post(":id/estorno")
  @HttpCode(200)
  async estorno(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    await this.svc.assertSubmodule(ctx, "cancel");
    // multipart: campo "file" (comprovante, opcional) + campos amountCents/method/notes
    let proofUrl: string | null = null;
    const fields: Record<string, string> = {};
    const parts = (req as any).parts ? (req as any).parts() : null;
    if (parts) {
      for await (const part of parts) {
        if (part.type === "file") {
          const buffer = await part.toBuffer();
          if (buffer.length > 15 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 15MB", 413);
          if (buffer.length > 0) { const up = await this.storage.putPublic({ keyPrefix: `production/${id}/estorno`, contentType: String(part.mimetype || "application/pdf"), body: buffer, originalName: part.filename }); proofUrl = up.url; }
        } else { fields[part.fieldname] = String(part.value); }
      }
    }
    const amountCents = Math.round(Number(fields.amountCents) || 0);
    return this.svc.registerEstorno(ctx, id, { amountCents, method: fields.method || null, proofUrl, notes: fields.notes || null });
  }
  // ---------------- Autorização de desconto (código de 4 dígitos) ----------------
  @Get("auth-admins")
  async authAdmins(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listAuthAdmins(ctx) };
  }

  /** Limite (%) de desconto que ESTE usuário pode aplicar sozinho. Owner/admin
   *  recebem 100 (ignora o teto). Demais leem a config grafica. */
  @Get("max-discount-pct")
  async maxDiscountPct(@CurrentContext() ctx: RequestContext) {
    return { maxPct: await this.svc.maxOperatorDiscountPct(ctx) };
  }

  /** Atribui costureira (Supplier type=costureira) a um pedido. supplierId=null tira. */
  @Post(":id/assign")
  @HttpCode(200)
  @RequirePermission("production.assign")
  async assign(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ supplierId: z.string().uuid().nullable() }).parse(body);
    return { order: await this.svc.assignSupplier(ctx, id, input.supplierId) };
  }

  /** Relatório admin de produção por costureira no período. */
  @Get("by-supplier/:supplierId/report")
  @RequirePermission("payouts.manage")
  async supplierReport(
    @CurrentContext() ctx: RequestContext,
    @Param("supplierId") supplierId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.svc.productionReportForSupplier(ctx, supplierId, { from, to });
  }

  /** OSs prontas pendentes de pagamento da costureira (sem settlement ainda). */
  @Get("by-supplier/:supplierId/pending")
  @RequirePermission("payouts.manage")
  async supplierPending(@CurrentContext() ctx: RequestContext, @Param("supplierId") supplierId: string) {
    return this.svc.productionPendingForSupplier(ctx, supplierId);
  }
  @Post("discount-auth")
  @HttpCode(200)
  async discountAuth(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ adminMembershipId: z.string().uuid(), discountCents: z.number().int().min(1), orderId: z.string().uuid().nullable().optional() }).parse(body);
    return this.svc.requestDiscountAuth(ctx, input);
  }
  /** Upload da NF do pedido (PDF/imagem). */
  @Post(":id/nf")
  async uploadNf(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Req() req: FastifyRequest) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    await this.svc.assertSubmodule(ctx, "nf");
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    const buffer = await data.toBuffer();
    if (buffer.length > 15 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 15MB", 413);
    const { url } = await this.storage.putPublic({ keyPrefix: `production/${id}/nf`, contentType: mime || "application/pdf", body: buffer, originalName: data.filename });
    return { order: await this.svc.attachNf(ctx, id, url) };
  }
  // ---------------- Catálogo da gráfica (valores + medidas) ----------------
  @Get("catalog")
  async catalog(@CurrentContext() ctx: RequestContext) {
    return this.svc.listCatalog(ctx);
  }
  /** Busca pro pedido: tabela de valores (faixas) + produtos do PDV. */
  @Get("catalog/search")
  async catalogSearch(@CurrentContext() ctx: RequestContext, @Query("q") q?: string) {
    return this.svc.searchCatalog(ctx, q ?? "");
  }
  @Post("catalog/price-item")
  @HttpCode(200)
  async upsertPriceItem(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    await this.svc.assertSubmodule(ctx, "tabelas");
    const input = z.object({
      id: z.string().uuid().nullable().optional(),
      category: z.string().max(80).nullable().optional(),
      name: z.string().min(1).max(160),
      unitLabel: z.string().max(40).nullable().optional(),
      tiers: z.array(z.object({ minQty: z.number().int().min(1), priceCents: z.number().int().min(0) })).max(20),
      sortOrder: z.number().int().optional(),
      active: z.boolean().optional(),
    }).parse(body);
    return { item: await this.svc.upsertPriceItem(ctx, input) };
  }
  @Post("catalog/price-item/:id/delete")
  @HttpCode(200)
  async deletePriceItem(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    await this.svc.assertSubmodule(ctx, "tabelas");
    return this.svc.deletePriceItem(ctx, id);
  }
  @Post("catalog/size-chart")
  @HttpCode(200)
  async upsertSizeChart(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    await this.svc.assertSubmodule(ctx, "tabelas");
    const input = z.object({
      id: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(80),
      rows: z.array(z.object({ size: z.string().min(1).max(40), comprimento: z.string().max(20).nullable().optional(), largura: z.string().max(20).nullable().optional() })).max(40),
      sortOrder: z.number().int().optional(),
      active: z.boolean().optional(),
    }).parse(body);
    return { chart: await this.svc.upsertSizeChart(ctx, input) };
  }
  @Post("catalog/size-chart/:id/delete")
  @HttpCode(200)
  async deleteSizeChart(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteSizeChart(ctx, id);
  }
  @Post("catalog/seed-2025")
  @HttpCode(200)
  async seed2025(@CurrentContext() ctx: RequestContext) {
    return this.svc.seedDefault2025(ctx);
  }

  @Get(":id")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { order: await this.svc.getById(ctx, id) };
  }
  @Post()
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { order: await this.svc.create(ctx, UpsertSchema.parse(body)) };
  }
  @Patch(":id")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { order: await this.svc.update(ctx, id, UpsertSchema.partial().parse(body)) };
  }
  @Patch(":id/status")
  async setStatus(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string }) {
    return { order: await this.svc.setStatus(ctx, id, b?.status) };
  }

  /** Estágios ativos do kanban pra ESTA org. Front usa pra decidir colunas. */
  @Get("stages")
  async stages(@CurrentContext() ctx: RequestContext) {
    return this.svc.activeStagesFor(ctx);
  }

  /** Assinatura SIMPLIFICADA do cliente na OS na finalização (PNG via canvas).
   *  Sem certificado — só comprovação de retirada/aprovação. */
  @Post(":id/customer-signature")
  @HttpCode(200)
  async customerSignature(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown, @Req() req: any) {
    const input = z.object({ signatureDataUrl: z.string().min(50).startsWith("data:image/") }).parse(body);
    const ip = (req.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    return { order: await this.svc.saveCustomerSignature(ctx, id, input.signatureDataUrl, ip) };
  }
  /** Substitui a ficha técnica (roster jogador/número/tamanho/qtd) do pedido. */
  @Patch(":id/roster")
  async setRoster(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ rows: z.array(z.object({ playerName: z.string().min(1).max(120), number: z.string().max(10).nullable().optional(), size: z.string().max(20).nullable().optional(), modelKey: z.string().max(40).nullable().optional(), qty: z.number().int().min(1).max(1000).optional(), notes: z.string().max(300).nullable().optional() })) }).parse(body);
    return { roster: await this.svc.setRoster(ctx, id, input.rows) };
  }
  /** Define a GRADE do pedido (modelos com tamanhos permitidos). [] limpa. */
  @Patch(":id/grade")
  async setGrade(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const input = z.object({ models: z.array(z.object({ key: z.string().max(40).nullable().optional(), label: z.string().min(1).max(60), sizes: z.array(z.string().max(20)).max(40) })).max(20) }).parse(body);
    return { order: await this.svc.setGrade(ctx, id, input.models) };
  }
  /** Define os tecidos/insumos consumidos do estoque pelo pedido (baixa ao entrar em produção). */
  @Patch(":id/fabrics")
  async setFabrics(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ rows: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(0).max(1000000) })) }).parse(body);
    return { order: await this.svc.setFabrics(ctx, id, input.rows) };
  }
  @Post(":id/art-review")
  @HttpCode(200)
  async reviewArt(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(1000).nullable().optional() }).parse(body);
    return { order: await this.svc.reviewArt(ctx, id, { ...input, reviewer: "staff" }) };
  }
  /** Upload de arquivo do pedido (cliente/arte) — multipart. ?kind=client_asset|art */
  @Post(":id/files")
  async uploadFile(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Query("kind") kind: string, @Req() req: FastifyRequest) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const k = kind === "art" ? "art" : "client_asset";
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo não enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!FILE_MIME.has(mime)) throw new AppError(ErrorCode.ValidationFailed, `Tipo não permitido: ${mime}`, 400);
    const buffer = await data.toBuffer();
    if (buffer.length > 25 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Arquivo maior que 25MB", 413);
    const { url } = await this.storage.putPublic({ keyPrefix: `production/${id}/${k}`, contentType: mime, body: buffer, originalName: data.filename });
    const file = await this.svc.addFile(ctx, id, { kind: k, url, name: data.filename, uploadedBy: "staff" });
    return { ok: true, file };
  }
  @Delete(":id")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.remove(ctx, id);
  }
}
