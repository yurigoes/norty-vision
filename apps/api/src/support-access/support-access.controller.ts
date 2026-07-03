import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SupportAccessService } from "./support-access.service";

@Controller()
export class SupportAccessController {
  constructor(private readonly svc: SupportAccessService) {}

  // ---- master ----
  @Get("platform/orgs/:id/support-access")
  async list(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.list(ctx, id) };
  }
  @Post("platform/orgs/:id/support-access")
  @HttpCode(201)
  async grant(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { duration } = z.object({ duration: z.enum(["24h", "30d", "90d", "sempre"]) }).parse(body);
    return this.svc.grant(ctx, id, duration);
  }
  @Delete("platform/support-access/:grantId")
  async revokeMaster(@CurrentContext() ctx: RequestContext, @Param("grantId") grantId: string) {
    return this.svc.revoke(ctx, grantId);
  }

  // ---- empresa (vê e pode revogar o acesso do suporte) ----
  @Get("support-access/mine")
  async mine(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listForOrg(ctx) };
  }
  @Post("support-access/:grantId/revoke")
  @HttpCode(200)
  async revokeOrg(@CurrentContext() ctx: RequestContext, @Param("grantId") grantId: string) {
    return this.svc.revoke(ctx, grantId, "revogado pela empresa");
  }
}
