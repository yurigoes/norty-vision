import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { HelpdeskService } from "./helpdesk.service";

@Controller("helpdesk")
export class HelpdeskController {
  constructor(private readonly svc: HelpdeskService) {}

  // ---- config ----
  @Get("config")
  config(@CurrentContext() ctx: RequestContext) {
    return this.svc.listConfig(ctx);
  }
  @Post("categories")
  @HttpCode(200)
  upsertCategory(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertCategory(ctx, b);
  }
  @Post("teams")
  @HttpCode(200)
  upsertTeam(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertTeam(ctx, b);
  }
  @Post("sla")
  @HttpCode(200)
  upsertSla(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsertSla(ctx, b);
  }
  @Post("business-hours")
  @HttpCode(200)
  setHours(@CurrentContext() ctx: RequestContext, @Body() b: { rows: any[] }) {
    return this.svc.setBusinessHours(ctx, b?.rows ?? []);
  }

  // ---- tickets ----
  @Get("tickets")
  async tickets(@CurrentContext() ctx: RequestContext, @Query() q: any) {
    return { items: await this.svc.listTickets(ctx, q ?? {}) };
  }
  @Post("tickets")
  @HttpCode(200)
  create(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.createTicket(ctx, b);
  }
  @Get("tickets/:id")
  get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.getTicket(ctx, id);
  }
  @Post("tickets/:id/messages")
  @HttpCode(200)
  message(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { body: string; isInternal?: boolean }) {
    return this.svc.addMessage(ctx, id, b);
  }
  @Post("tickets/:id/assign")
  @HttpCode(200)
  assign(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { membershipId: string | null }) {
    return this.svc.assign(ctx, id, b?.membershipId ?? null);
  }
  @Post("tickets/:id/status")
  @HttpCode(200)
  status(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string }) {
    return this.svc.setStatus(ctx, id, b?.status);
  }
  @Post("tickets/:id/confirm-close")
  @HttpCode(200)
  confirmClose(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { rating?: number; comment?: string; satisfied: boolean }) {
    return this.svc.confirmClose(ctx, id, b);
  }

  // ---- ordens de serviço ----
  @Get("service-orders")
  async serviceOrders(@CurrentContext() ctx: RequestContext, @Query() q: any) {
    return { items: await this.svc.listServiceOrders(ctx, q ?? {}) };
  }
  @Get("service-orders/:id")
  async serviceOrder(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.getServiceOrder(ctx, id);
  }
  @Post("service-orders")
  @HttpCode(200)
  createSo(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.createServiceOrder(ctx, b);
  }
  @Post("service-orders/:id")
  @HttpCode(200)
  updateSo(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) {
    return this.svc.updateServiceOrder(ctx, id, b ?? {});
  }
  @Post("service-orders/:id/status")
  @HttpCode(200)
  soStatus(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: string }) {
    return this.svc.setServiceOrderStatus(ctx, id, b?.status);
  }
}
