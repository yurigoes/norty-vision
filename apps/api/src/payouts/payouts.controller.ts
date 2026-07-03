import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply } from "fastify";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PayoutsService } from "./payouts.service";

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  items: z.array(z.object({
    sourceType: z.enum(["lens_lab", "lens_doctor", "manual"]),
    sourceId: z.string().uuid().nullable().optional(),
    description: z.string().min(1).max(300),
    amountCents: z.number().int().min(0),
  })).min(1),
  notes: z.string().max(1000).nullable().optional(),
});

const PaySchema = z.object({
  paymentMethod: z.string().min(1).max(60),
  paymentId: z.string().max(120).nullable().optional(),
  proofUrl: z.string().url().nullable().optional(),
});

@Controller("payouts")
export class PayoutsController {
  constructor(private readonly svc: PayoutsService) {}

  @Get("pending/:supplierId")
  @RequirePermission("payouts.manage")
  async pending(@CurrentContext() ctx: RequestContext, @Param("supplierId") supplierId: string) {
    return { items: await this.svc.pending(ctx, supplierId) };
  }

  @Get("settlements")
  @RequirePermission("payouts.manage")
  async list(@CurrentContext() ctx: RequestContext, @Query("supplierId") supplierId?: string) {
    return { items: await this.svc.listSettlements(ctx, { supplierId }) };
  }

  @Post("settlements")
  @HttpCode(201)
  @RequirePermission("payouts.manage")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { settlement: await this.svc.createSettlement(ctx, CreateSchema.parse(body)) };
  }

  @Post("settlements/:id/pay")
  @HttpCode(200)
  @RequirePermission("payouts.manage")
  async pay(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { settlement: await this.svc.paySettlement(ctx, id, PaySchema.parse(body)) };
  }

  @Get("settlements/:id/receipt")
  @RequirePermission("payouts.manage")
  async receipt(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.receiptHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  @Get("profit")
  @RequirePermission("reports.financial")
  async profit(@CurrentContext() ctx: RequestContext, @Query("start") start?: string, @Query("end") end?: string) {
    return this.svc.profit(ctx, { start, end });
  }
}
