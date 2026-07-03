import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { RateLimitService } from "../redis/rate-limit.service";
import { MarketplaceService } from "./marketplace.service";

function clientIp(req: FastifyRequest): string {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "unknown";
}

const LeadSchema = z.object({
  customerName: z.string().min(2).max(120),
  customerPhone: z.string().min(8).max(20),
  message: z.string().max(2000).nullable().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(200),
    qty: z.number().int().min(1),
    unitPriceCents: z.number().int().min(0),
  })).max(50).default([]),
});

const SettingsSchema = z.object({
  catalogEnabled: z.boolean().optional(),
  catalogHeadline: z.string().max(200).nullable().optional(),
  catalogWhatsapp: z.string().max(20).nullable().optional(),
});

@Controller()
export class MarketplaceController {
  constructor(
    private readonly svc: MarketplaceService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ---------- Vitrine pública (sem auth) ----------
  @Public()
  @Get("public/catalog/:slug")
  async catalog(@Param("slug") slug: string) {
    return this.svc.getPublicCatalog(slug);
  }

  @Public()
  @Post("public/catalog/:slug/lead")
  @HttpCode(201)
  async lead(@Req() req: FastifyRequest, @Param("slug") slug: string, @Body() body: unknown) {
    // máx. 8 pedidos / 10 min por IP
    await this.rateLimit.enforce(`lead:${clientIp(req)}`, 8, 600);
    return this.svc.createLead(slug, LeadSchema.parse(body));
  }

  // ---------- Admin (painel da empresa) ----------
  @Get("marketplace/leads")
  async leads(@CurrentContext() ctx: RequestContext, @Query("storeId") storeId?: string) {
    return { items: await this.svc.listLeads(ctx, { storeId }) };
  }

  @Patch("marketplace/leads/:id")
  async updateLead(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ status: z.enum(["new", "contacted", "converted", "dismissed"]) }).parse(body);
    return { lead: await this.svc.updateLeadStatus(ctx, id, input.status) };
  }

  @Patch("marketplace/stores/:storeId/settings")
  async settings(
    @CurrentContext() ctx: RequestContext,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    return { store: await this.svc.updateSettings(ctx, storeId, SettingsSchema.parse(body)) };
  }

  @Patch("marketplace/products/:productId/catalog")
  async productCatalog(
    @CurrentContext() ctx: RequestContext,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ show: z.boolean() }).parse(body);
    return { product: await this.svc.setProductInCatalog(ctx, productId, input.show) };
  }
}
