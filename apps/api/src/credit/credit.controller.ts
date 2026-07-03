import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { CreditService } from "./credit.service";

const CreateAccountSchema = z.object({
  document: z.string().min(11).max(20),
  holderName: z.string().min(2).max(120),
  primaryCustomerId: z.string().uuid().nullable().optional(),
  limitCents: z.number().int().min(0),
  guarantorName: z.string().max(120).nullable().optional(),
  guarantorDocument: z.string().max(20).nullable().optional(),
  guarantorPhone: z.string().max(30).nullable().optional(),
});

const ConfigSchema = z.object({
  defaultMaxInstallments: z.number().int().min(1).max(120).optional(),
  lateFeePct: z.number().min(0).max(10).optional(),
  monthlyInterestPct: z.number().min(0).max(20).optional(),
  monthlyCorrectionPct: z.number().min(0).max(20).optional(),
  defaultCreditInterestPct: z.number().min(0).max(1000).optional(),
  defaultEarlyPaymentDiscountPct: z.number().min(0).max(100).optional(),
  maxOperatorDiscountPct: z.number().min(0).max(100).optional(),
  autoBlockAfterOverdueCount: z.number().int().min(1).max(99).optional(),
  cardRetryMaxAttempts: z.number().int().min(1).max(10).optional(),
  requireSignedContract: z.boolean().optional(),
});

@Controller("credit")
export class CreditController {
  constructor(private readonly svc: CreditService) {}

  // config
  @Get("config")
  @RequirePermission("credit.view")
  async getConfig(@CurrentContext() ctx: RequestContext) {
    return { config: await this.svc.getConfig(ctx) };
  }
  @Patch("config")
  @RequirePermission("payments.config")
  async updateConfig(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { config: await this.svc.updateConfig(ctx, ConfigSchema.parse(body)) };
  }

  // accounts
  @Get("accounts")
  @RequirePermission("credit.view")
  async listAccounts(
    @CurrentContext() ctx: RequestContext,
    @Query("q") search?: string,
    @Query("status") status?: string,
  ) {
    return { items: await this.svc.listAccounts(ctx, { search, status }) };
  }

  @Get("accounts/:id")
  @RequirePermission("credit.view")
  async getAccount(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { account: await this.svc.getAccount(ctx, id) };
  }

  @Post("accounts")
  @HttpCode(201)
  @RequirePermission("credit.approve")
  async createAccount(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { account: await this.svc.createAccount(ctx, CreateAccountSchema.parse(body)) };
  }

  @Patch("accounts/:id/limit")
  @RequirePermission("credit.approve")
  async setLimit(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { limitCents: number },
  ) {
    return { account: await this.svc.setLimit(ctx, id, body.limitCents) };
  }

  @Patch("accounts/:id/block")
  @RequirePermission("credit.approve")
  async block(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ) {
    return { account: await this.svc.block(ctx, id, body.reason ?? "manual") };
  }

  @Patch("accounts/:id/unblock")
  @RequirePermission("credit.approve")
  async unblock(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { account: await this.svc.unblock(ctx, id) };
  }

  @Patch("accounts/:id/freeze")
  @RequirePermission("credit.approve")
  async freeze(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { until: string },
  ) {
    return { account: await this.svc.freeze(ctx, id, body.until) };
  }

  // limit requests
  @Post("accounts/:id/limit-request")
  @HttpCode(201)
  @RequirePermission("credit.view")
  async requestLimit(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { requestedLimitCents: number; reason?: string },
  ) {
    return {
      request: await this.svc.requestLimit(ctx, id, body.requestedLimitCents, body.reason),
    };
  }

  @Get("limit-requests")
  @RequirePermission("credit.view")
  async listLimitRequests(
    @CurrentContext() ctx: RequestContext,
    @Query("status") status?: string,
  ) {
    return { items: await this.svc.listLimitRequests(ctx, status ?? "pending") };
  }

  @Patch("limit-requests/:id/approve")
  @RequirePermission("credit.approve")
  async approve(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { note?: string },
  ) {
    return {
      request: await this.svc.reviewLimitRequest(ctx, id, "approved", {
        via: "panel",
        note: body?.note,
      }),
    };
  }

  @Patch("limit-requests/:id/reject")
  @RequirePermission("credit.approve")
  async reject(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { note?: string },
  ) {
    return {
      request: await this.svc.reviewLimitRequest(ctx, id, "rejected", {
        via: "panel",
        note: body?.note,
      }),
    };
  }

  // applications (KYC do cliente)
  @Get("applications")
  @RequirePermission("credit.view")
  async listApplications(
    @CurrentContext() ctx: RequestContext,
    @Query("status") status?: string,
  ) {
    return { items: await this.svc.listApplications(ctx, status ?? "pending") };
  }

  @Get("applications/:id/docs")
  @RequirePermission("credit.view")
  async appDocs(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.getApplicationDocs(ctx, id);
  }

  /** Serve um documento KYC privado (admin). */
  @Get("documents/:docId/file")
  @RequirePermission("credit.view")
  async docFile(
    @CurrentContext() ctx: RequestContext,
    @Param("docId") docId: string,
    @Res() reply: FastifyReply,
  ) {
    const { body, contentType } = await this.svc.getDocumentFile(ctx, docId);
    reply.type(contentType).send(body);
  }

  @Patch("applications/:id/approve")
  @RequirePermission("credit.approve")
  async approveApp(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { approvedLimitCents?: number; note?: string },
  ) {
    return {
      application: await this.svc.reviewApplication(ctx, id, "approved", {
        approvedLimitCents: body?.approvedLimitCents,
        note: body?.note,
      }),
    };
  }

  @Patch("applications/:id/reject")
  @RequirePermission("credit.approve")
  async rejectApp(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { note?: string },
  ) {
    return {
      application: await this.svc.reviewApplication(ctx, id, "rejected", { note: body?.note }),
    };
  }
}
