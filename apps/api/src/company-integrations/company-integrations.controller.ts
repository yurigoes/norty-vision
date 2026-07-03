import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { CompanyIntegrationsService } from "./company-integrations.service";

@Controller("company-integrations")
export class CompanyIntegrationsController {
  constructor(private readonly svc: CompanyIntegrationsService) {}

  @Get()
  @RequirePermission("integrations.manage")
  async status(@CurrentContext() ctx: RequestContext) {
    return this.svc.status(ctx);
  }

  @Get("alerts")
  @RequirePermission("integrations.manage")
  async alerts(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.internalAlerts(ctx) };
  }

  @Get("shortcuts")
  @RequirePermission("integrations.manage")
  async shortcuts(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.shortcuts(ctx) };
  }

  // ---- Evolution (instância por empresa = slug) ----
  @Post("evolution/create")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async create(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionCreate(ctx);
  }

  @Get("evolution/qr")
  @RequirePermission("integrations.manage")
  async qr(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionQr(ctx);
  }

  @Get("evolution/state")
  @RequirePermission("integrations.manage")
  async state(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionState(ctx);
  }

  @Post("evolution/restart")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async restart(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionRestart(ctx);
  }

  @Post("evolution/disconnect")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async disconnect(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionDisconnect(ctx);
  }

  @Post("evolution/delete")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async remove(@CurrentContext() ctx: RequestContext) {
    return this.svc.evolutionDelete(ctx);
  }

  // ---- instâncias EXTRAS (multi-número do call center) ----
  @Get("evolution/instances")
  @RequirePermission("integrations.manage")
  async instances(@CurrentContext() ctx: RequestContext) {
    return this.svc.listInstances(ctx);
  }
  @Post("evolution/instances")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async createExtra(@CurrentContext() ctx: RequestContext, @Body() b: { label?: string }) {
    return this.svc.createExtraInstance(ctx, b?.label);
  }
  @Get("evolution/instances/:id/qr")
  @RequirePermission("integrations.manage")
  async extraQr(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.extraQr(ctx, id);
  }
  @Get("evolution/instances/:id/state")
  @RequirePermission("integrations.manage")
  async extraState(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.extraState(ctx, id);
  }
  @Post("evolution/instances/:id/update")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async updateExtra(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { label: string }) {
    return this.svc.updateExtra(ctx, id, b?.label ?? "");
  }
  @Post("evolution/instances/:id/delete")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async deleteExtra(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.extraDelete(ctx, id);
  }
}
