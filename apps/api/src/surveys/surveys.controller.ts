import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Public, CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SurveysService } from "./surveys.service";

const RespondSchema = z.object({
  npsScore: z.number().int().min(0).max(10).nullable().optional(),
  sellerRating: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().max(1000).nullable().optional(),
});

const ManualSchema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  sellerUserId: z.string().uuid().optional(),
});

@Controller("surveys")
export class SurveysController {
  constructor(private readonly svc: SurveysService) {}

  // ===== público (sem auth) =====
  @Public()
  @Get("public/:token")
  async getPublic(@Param("token") token: string) {
    return this.svc.getPublic(token);
  }

  @Public()
  @Post("public/:token/respond")
  @HttpCode(200)
  async respond(@Param("token") token: string, @Body() body: unknown) {
    return this.svc.respond(token, RespondSchema.parse(body));
  }

  // ===== admin =====
  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ) {
    return this.svc.list(ctx, { start, end });
  }

  @Post("manual")
  @HttpCode(201)
  async manual(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = ManualSchema.parse(body);
    if (!ctx.orgId) return { ok: false };
    const survey = await this.svc.createAndSend({
      organizationId: ctx.orgId,
      storeId: input.storeId ?? ctx.storeId ?? null,
      customerId: input.customerId,
      sellerUserId: input.sellerUserId ?? null,
      kind: "manual",
    });
    return { ok: true, survey };
  }
}
