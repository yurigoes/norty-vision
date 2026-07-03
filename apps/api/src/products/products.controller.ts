import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { ProductsService } from "./products.service";

const IMG_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const UpsertSchema = z.object({
  storeId: z.string().uuid().nullable().optional(),
  sku: z.string().max(60).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  priceCashCents: z.number().int().min(0).nullable().optional(),
  priceCardFullCents: z.number().int().min(0).nullable().optional(),
  priceCardInstallmentsCents: z.number().int().min(0).nullable().optional(),
  priceCreditCents: z.number().int().min(0).nullable().optional(),
  creditInterestPct: z.number().min(0).max(1000).nullable().optional(),
  earlyPaymentDiscountPct: z.number().min(0).max(100).nullable().optional(),
  maxInstallments: z.number().int().min(1).max(120).nullable().optional(),
  stockQty: z.number().int().min(0).optional(),
  minStockQty: z.number().int().min(0).optional(),
  trackStock: z.boolean().optional(),
  isActive: z.boolean().optional(),
  showInCatalog: z.boolean().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  laboratorySupplierId: z.string().uuid().nullable().optional(),
  // fiscais (NFC-e/NF-e) — sem isto o zod descartava e o NCM não persistia
  ncm: z.string().max(20).nullable().optional(),
  cfop: z.string().max(10).nullable().optional(),
  cest: z.string().max(20).nullable().optional(),
  cst: z.string().max(5).nullable().optional(),
  csosn: z.string().max(5).nullable().optional(),
  origem: z.number().int().min(0).max(8).nullable().optional(),
  unidade: z.string().max(10).nullable().optional(),
});

@Controller("products")
export class ProductsController {
  constructor(
    private readonly svc: ProductsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @RequirePermission("products.view")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("q") search?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("storeId") storeId?: string,
  ) {
    return { items: await this.svc.list(ctx, { search, activeOnly: activeOnly === "true", storeId: storeId || undefined }) };
  }

  // ---- relatórios de estoque (rotas literais antes de :id) ----
  @Get("reports/low-stock")
  @RequirePermission("products.view")
  async lowStock(@CurrentContext() ctx: RequestContext) {
    return this.svc.lowStockReport(ctx);
  }
  @Get("reports/best-sellers")
  @RequirePermission("reports.sales")
  async bestSellers(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) {
    return this.svc.bestSellersReport(ctx, { from, to });
  }
  @Get("reports/inventory-analytics")
  @RequirePermission("products.view")
  async inventoryAnalytics(@CurrentContext() ctx: RequestContext) {
    return this.svc.inventoryAnalytics(ctx);
  }
  @Get("reports/inventory.csv")
  @RequirePermission("products.view")
  async inventoryCsv(@CurrentContext() ctx: RequestContext, @Query("kind") kind: string, @Res() reply: FastifyReply) {
    const { filename, csv } = await this.svc.inventoryCsv(ctx, kind ?? "low_stock");
    reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send("﻿" + csv);
  }
  @Get("reports/by-store")
  @RequirePermission("products.view")
  async byStore(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.stockByStoreReport(ctx) };
  }

  @Get(":id")
  @RequirePermission("products.view")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { product: await this.svc.getById(ctx, id) };
  }

  @Get(":id/movements")
  @RequirePermission("products.view")
  async movements(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.movements(ctx, id) };
  }

  @Get(":id/store-stock")
  @RequirePermission("products.view")
  async storeStock(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.storeStock(ctx, id) };
  }

  @Post(":id/adjust-stock")
  @HttpCode(200)
  @RequirePermission("products.stock")
  async adjustStock(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ mode: z.enum(["set", "delta"]), qty: z.number().int(), reason: z.string().max(200).nullable().optional(), costCents: z.number().int().min(0).nullable().optional(), storeId: z.string().uuid().nullable().optional() }).parse(body);
    return { product: await this.svc.adjustStock(ctx, id, input) };
  }

  /** Transferência de saldo entre lojas. */
  @Post(":id/transfer-stock")
  @HttpCode(200)
  @RequirePermission("products.stock")
  async transferStock(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ fromStoreId: z.string().uuid(), toStoreId: z.string().uuid(), qty: z.number().int().min(1), reason: z.string().max(200).nullable().optional() }).parse(body);
    return this.svc.transferStock(ctx, id, input);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("products.create")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { product: await this.svc.create(ctx, UpsertSchema.parse(body)) };
  }

  /** Importação em massa de estoque (catálogo). */
  @Post("import")
  @HttpCode(200)
  @RequirePermission("products.import")
  async bulkImport(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      reuseImage: z.boolean().optional(),
      items: z.array(z.object({
        sku: z.string().max(60).nullable().optional(),
        name: z.string().min(1).max(200),
        category: z.string().max(80).nullable().optional(),
        priceCents: z.number().int().min(0).nullable().optional(),
        stockQty: z.number().int().nullable().optional(),
        ncm: z.string().max(20).nullable().optional(),
        unidade: z.string().max(6).nullable().optional(),
      })).min(1).max(5000),
    }).parse(body);
    return this.svc.bulkImport(ctx, input);
  }

  @Patch(":id")
  @RequirePermission("products.edit")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { product: await this.svc.update(ctx, id, UpsertSchema.partial().parse(body)) };
  }

  /** Upload de imagem do produto (multipart). */
  @Post(":id/image")
  async uploadImage(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Req() req: FastifyRequest,
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!IMG_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 6 * 1024 * 1024) {
      throw new AppError(ErrorCode.ValidationFailed, "Imagem maior que 6MB", 413);
    }
    const { url } = await this.storage.putPublic({
      keyPrefix: `products/${id}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    await this.svc.update(ctx, id, { imageUrl: url } as any);
    return { ok: true, url };
  }

  @Delete(":id")
  @RequirePermission("products.delete")
  async remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { product: await this.svc.softDelete(ctx, id) };
  }
}
