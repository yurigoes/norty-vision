import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { CommissionsService } from "./commissions.service";

const CreateSchema = z.object({
  sellerUserId: z.string().uuid(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  salesCount: z.number().int().min(0).optional(),
  baseCents: z.number().int().min(0).optional(),
  commissionPct: z.number().min(0).max(100).nullable().optional(),
  totalCents: z.number().int().min(0),
  notes: z.string().max(1000).nullable().optional(),
});

const PaySchema = z.object({
  paymentMethod: z.string().min(1).max(60),
  paymentId: z.string().max(120).nullable().optional(),
  proofUrl: z.string().url().nullable().optional(),
});

@Controller("commissions")
export class CommissionsController {
  constructor(private readonly svc: CommissionsService) {}

  @Get("pending/:sellerUserId")
  async pending(
    @CurrentContext() ctx: RequestContext,
    @Param("sellerUserId") sellerUserId: string,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ) {
    return await this.svc.pending(ctx, sellerUserId, { start, end });
  }

  @Get("payouts")
  async list(@CurrentContext() ctx: RequestContext, @Query("sellerUserId") sellerUserId?: string) {
    return { items: await this.svc.listPayouts(ctx, { sellerUserId }) };
  }

  @Post("payouts")
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { payout: await this.svc.createPayout(ctx, CreateSchema.parse(body)) };
  }

  @Post("payouts/:id/pay")
  @HttpCode(200)
  async pay(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { payout: await this.svc.payPayout(ctx, id, PaySchema.parse(body)) };
  }

  @Get("payouts/:id/receipt")
  async receipt(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.receiptHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }
}
