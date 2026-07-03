import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { CrmService } from "./crm.service";

@Controller("crm")
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @Get("leads")
  @RequirePermission("leads.view")
  async leads(@CurrentContext() ctx: RequestContext, @Query("view") view?: string) {
    if (view === "mine") return { items: await this.svc.mine(ctx) };
    return { items: await this.svc.fila(ctx) }; // default = fila de novos
  }

  @Get("board")
  @RequirePermission("leads.view")
  async board(@CurrentContext() ctx: RequestContext) { return this.svc.board(ctx); }

  @Get("supervision")
  @RequirePermission("crm.supervise")
  async supervision(@CurrentContext() ctx: RequestContext) { return this.svc.supervision(ctx); }

  @Get("tabulations")
  @RequirePermission("leads.view")
  async tabulations(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.tabulations(ctx) }; }

  @Get("leads/:id")
  @RequirePermission("leads.view")
  async get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { lead: await this.svc.getLead(ctx, id) }; }

  @Post("leads")
  @HttpCode(201)
  @RequirePermission("leads.create")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ name: z.string().min(1).max(200), phone: z.string().max(40).nullable().optional(), email: z.string().max(200).nullable().optional(), source: z.string().max(40).optional(), tags: z.array(z.string().max(40)).optional() }).parse(body);
    return { lead: await this.svc.create(ctx, input) };
  }

  @Post("leads/:id/claim")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async claim(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { lead: await this.svc.claim(ctx, id) }; }

  @Patch("leads/:id/stage")
  @RequirePermission("leads.view")
  async stage(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ stage: z.string(), tabulation: z.string().max(120).optional(), lostReason: z.string().max(300).optional() }).parse(body);
    return { lead: await this.svc.setStage(ctx, id, input.stage, { tabulation: input.tabulation, lostReason: input.lostReason }) };
  }

  @Post("leads/:id/interaction")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async interaction(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ kind: z.enum(["call", "note", "whatsapp_out", "email"]), body: z.string().max(2000).optional(), tabulation: z.string().max(120).optional() }).parse(body);
    return { lead: await this.svc.addInteraction(ctx, id, input) };
  }

  @Patch("leads/:id")
  @RequirePermission("leads.assign")
  async update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ tags: z.array(z.string().max(40)).optional(), ownerMembershipId: z.string().uuid().nullable().optional(), nextActionAt: z.string().nullable().optional() }).parse(body);
    return { lead: await this.svc.update(ctx, id, input) };
  }

  @Post("leads/:id/video")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async video(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.startMeeting(ctx, id, false); }

  @Post("leads/:id/audio")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async audio(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.startMeeting(ctx, id, true); }

  @Post("leads/:id/task")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async task(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ title: z.string().min(1).max(200), dueAt: z.string().nullable().optional() }).parse(body);
    return { lead: await this.svc.addTask(ctx, id, input) };
  }

  @Post("tasks/:taskId/done")
  @HttpCode(200)
  @RequirePermission("leads.view")
  async doneTask(@CurrentContext() ctx: RequestContext, @Param("taskId") taskId: string) { return { lead: await this.svc.completeTask(ctx, taskId) }; }
}
