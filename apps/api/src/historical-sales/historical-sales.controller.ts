import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { HistoricalSalesService } from "./historical-sales.service";

const RowSchema = z.object({
  legacyCode: z.string().max(40).nullable().optional(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productName: z.string().min(1).max(300),
  qty: z.number().optional(),
  unitPriceCents: z.number().int().optional(),
  discountCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
});

@Controller("historical-sales")
export class HistoricalSalesController {
  constructor(private readonly svc: HistoricalSalesService) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext, @Query("month") month?: string, @Query("q") q?: string, @Query("batchId") batchId?: string) {
    return { items: await this.svc.list(ctx, { month, q, batchId }) };
  }

  @Get("summary")
  async summary(@CurrentContext() ctx: RequestContext) { return this.svc.summary(ctx); }

  @Get("batches")
  async batches(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.batches(ctx) }; }

  @Post("import")
  @HttpCode(200)
  async import(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ rows: z.array(RowSchema).min(1), source: z.string().max(60).optional() }).parse(body);
    return this.svc.importRows(ctx, input.rows, input.source);
  }

  @Delete("batches/:batchId")
  async deleteBatch(@CurrentContext() ctx: RequestContext, @Param("batchId") batchId: string) {
    return this.svc.deleteBatch(ctx, batchId);
  }
}
