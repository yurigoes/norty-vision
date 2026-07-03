import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ExamsService } from "./exams.service";

const LineSchema = z.object({
  method: z.enum(["cash", "pix", "card"]),
  provider: z.string().max(20).optional(),     // mp | maquininha
  cardType: z.enum(["credit", "debit"]).optional(),
  amountCents: z.number().int().positive(),
});

const RecordSchema = z.object({
  storeId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  professionalId: z.string().uuid().optional(),
  lines: z.array(LineSchema).min(1),
  discountCents: z.number().int().nonnegative().optional(),
  authRequestId: z.string().uuid().optional(),
  authCode: z.string().max(8).optional(),
  notes: z.string().max(500).optional(),
  markAttended: z.boolean().optional(),
});

@Controller("exams")
export class ExamsController {
  constructor(private readonly svc: ExamsService) {}

  @Get("auth-admins")
  async authAdmins(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listAuthAdmins(ctx) };
  }

  @Post("discount-auth")
  @HttpCode(200)
  async discountAuth(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ adminMembershipId: z.string().uuid(), discountCents: z.number().int().positive() }).parse(body);
    return this.svc.requestDiscountAuth(ctx, input);
  }

  @Post("payments")
  @HttpCode(200)
  async record(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = RecordSchema.parse(body);
    return this.svc.recordExamPayment(ctx, input);
  }

  @Post("payments/:id/check")
  @HttpCode(200)
  async check(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.checkExamPayment(ctx, id);
  }

  @Get("payments")
  async list(@CurrentContext() ctx: RequestContext, @Query() q: { storeId?: string; from?: string; to?: string }) {
    return { items: await this.svc.listExamPayments(ctx, q ?? {}) };
  }
}
