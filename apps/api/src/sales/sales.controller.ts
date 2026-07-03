import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SalesService } from "./sales.service";

const ItemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productName: z.string().min(1).max(200),
  qty: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  priceType: z.enum(["cash", "card_full", "card_installments", "credit"]),
});

const CreateSaleSchema = z.object({
  storeId: z.string().uuid(),
  sellerUserId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  customerInline: z.object({
    name: z.string().min(2).max(120),
    document: z.string().max(20).nullable().optional(),
    birthDate: z.string().max(12).nullable().optional(),
  }).nullable().optional(),
  paymentMethod: z.enum(["cash", "pix", "card_full", "card_installments", "credit"]),
  payments: z.array(z.object({
    method: z.enum(["cash", "pix", "card"]),
    amountCents: z.number().int().positive(),
    provider: z.enum(["mp", "infinitepay"]).nullable().optional(),
    cardType: z.enum(["credit", "debit"]).nullable().optional(),
  })).optional(),
  items: z.array(ItemSchema).min(1),
  discountPctApplied: z.number().min(0).max(100).optional(),
  discountAuthorizedByUserId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  creditAccountId: z.string().uuid().nullable().optional(),
  downPaymentCents: z.number().int().min(0).optional(),
  installmentsCount: z.number().int().min(1).max(120).optional(),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // crediário como PARTE do split: valor financiado (o resto vai em payments[]).
  // Ex.: total 300 → creditAmountCents 100 + payments [pix 100, dinheiro 100].
  creditAmountCents: z.number().int().min(0).optional(),
});

@Controller("sales")
export class SalesController {
  constructor(private readonly svc: SalesService) {}

  @Get()
  @RequirePermission("sales.view")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return { items: await this.svc.list(ctx, { storeId, startDate, endDate }) };
  }

  /** Dashboard de vendas por vendedor no periodo (com comissao). */
  @Get("dashboard/sellers")
  @RequirePermission("reports.commission")
  async sellersDashboard(
    @CurrentContext() ctx: RequestContext,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ) {
    return this.svc.sellersDashboard(ctx, { start, end });
  }

  @Get(":id")
  @RequirePermission("sales.view")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { sale: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("sales.create")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { sale: await this.svc.create(ctx, CreateSaleSchema.parse(body)) };
  }

  @Patch(":id/nota-fiscal")
  @RequirePermission("sales.create")
  async attachNf(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { url: string },
  ) {
    return { sale: await this.svc.attachNotaFiscal(ctx, id, body.url) };
  }

  /** Cancela/devolve a venda e repõe o estoque dos itens. */
  @Patch(":id/cancel")
  @RequirePermission("sales.cancel")
  async cancel(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: { reason?: string }) {
    return this.svc.cancelSale(ctx, id, body?.reason ?? null);
  }
}
