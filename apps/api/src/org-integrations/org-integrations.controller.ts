import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { OrgIntegrationsService } from "./org-integrations.service";

const UpsertSchema = z.object({
  accessToken: z.string().min(10).max(500).nullable().optional(),
  publicKey: z.string().max(500).nullable().optional(),
  webhookSecret: z.string().max(500).nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  status: z.enum(["active", "disabled", "error"]).optional(),
  config: z.record(z.unknown()).optional(),
});

@Controller("org-integrations")
export class OrgIntegrationsController {
  constructor(private readonly svc: OrgIntegrationsService) {}

  @Get(":provider")
  @RequirePermission("integrations.manage")
  async get(@CurrentContext() ctx: RequestContext, @Param("provider") provider: string) {
    return { integration: await this.svc.getSafe(ctx, provider) };
  }

  @Patch(":provider")
  @RequirePermission("integrations.manage")
  async upsert(
    @CurrentContext() ctx: RequestContext,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ) {
    const input = UpsertSchema.parse(body);
    await this.svc.upsert(ctx, provider, input);
    return { integration: await this.svc.getSafe(ctx, provider) };
  }

  @Post(":provider/test")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async test(@CurrentContext() ctx: RequestContext, @Param("provider") provider: string) {
    return this.svc.test(ctx, provider);
  }
}
