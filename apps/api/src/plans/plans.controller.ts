import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, Public, RequirePlatformOwner } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PlansService } from "./plans.service";

const UpsertPlanSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  highlight: z.string().max(60).nullable().optional(),
  niche: z.string().max(40).nullable().optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional(),
  interval: z.enum(["monthly", "yearly"]).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  maxStores: z.number().int().min(1).nullable().optional(),
  maxUsers: z.number().int().min(1).nullable().optional(),
  maxMessagesMonth: z.number().int().min(0).nullable().optional(),
  features: z.array(z.string()),
  extraHighlights: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const UpdatePlanSchema = UpsertPlanSchema.partial().omit({ slug: true });

@Controller("plans")
export class PlansController {
  constructor(private readonly svc: PlansService) {}

  // publica
  @Public()
  @Get()
  async listPublic() {
    return { items: await this.svc.listActive() };
  }

  /** Planos visíveis para a empresa logada — só a mensalidade do nicho dela (+ genéricos). */
  @Get("for-org")
  async listForOrg(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listForOrg(ctx.orgId ?? null) };
  }

  @Public()
  @Get(":slug")
  async getBySlug(@Param("slug") slug: string) {
    return { plan: await this.svc.getBySlug(slug) };
  }

  // master
  @RequirePlatformOwner()
  @Get("admin/all")
  async listAll() {
    return { items: await this.svc.listAll() };
  }

  @RequirePlatformOwner()
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = UpsertPlanSchema.parse(body);
    return { plan: await this.svc.create(input) };
  }

  @RequirePlatformOwner()
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const input = UpdatePlanSchema.parse(body);
    return { plan: await this.svc.update(id, input) };
  }
}
