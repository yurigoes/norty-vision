import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ScheduleService } from "./schedule.service";

const BlockSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  blocks: z.array(
    z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      slotMinutes: z.number().int().min(5).max(480),
      capacity: z.number().int().min(1).optional(),
    }),
  ),
});

const UpsertTemplateSchema = z.object({
  professionalId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  weeklyBlocks: z.array(BlockSchema),
  validFrom: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const GenerateSlotsSchema = z.object({
  templateId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const OpenDaySchema = z.object({
  professionalId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periods: z.array(z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })).min(1),
  mode: z.enum(["byDuration", "byCount"]),
  slotMinutes: z.number().int().min(5).max(480).optional(),
  count: z.number().int().min(1).max(500).optional(),
  capacityPerSlot: z.number().int().min(1).max(200).optional(),
  label: z.string().max(120).nullable().optional(),
  dryRun: z.boolean().optional(),
});

@Controller("schedule")
export class ScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  // templates
  @Get("templates")
  @RequirePermission("agenda.view")
  async listTemplates(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
    @Query("professionalId") professionalId?: string,
  ) {
    return {
      items: await this.svc.listTemplates(ctx, { storeId, professionalId }),
    };
  }

  @Post("templates")
  @HttpCode(201)
  @RequirePermission("agenda.edit")
  async createTemplate(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = UpsertTemplateSchema.parse(body);
    return { template: await this.svc.createTemplate(ctx, input) };
  }

  @Patch("templates/:id")
  @RequirePermission("agenda.edit")
  async updateTemplate(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpsertTemplateSchema.partial().parse(body);
    return { template: await this.svc.updateTemplate(ctx, id, input) };
  }

  // slots
  @Post("slots/generate")
  @HttpCode(200)
  @RequirePermission("agenda.edit")
  async generateSlots(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = GenerateSlotsSchema.parse(body);
    return this.svc.generateSlots(ctx, input);
  }

  /** Abrir agenda de um dia (simples): por duração ou por quantidade. dryRun = preview. */
  @Post("open-day")
  @HttpCode(200)
  @RequirePermission("agenda.edit")
  async openDay(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.openDay(ctx, OpenDaySchema.parse(body));
  }

  @Get("month")
  @RequirePermission("agenda.view")
  async monthAvailability(
    @CurrentContext() ctx: RequestContext,
    @Query("month") month: string,
    @Query("professionalId") professionalId?: string,
    @Query("storeId") storeId?: string,
  ) {
    return this.svc.monthAvailability(ctx, { month, professionalId, storeId });
  }

  @Get("slots")
  @RequirePermission("agenda.view")
  async listSlots(
    @CurrentContext() ctx: RequestContext,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Query("storeId") storeId?: string,
    @Query("professionalId") professionalId?: string,
    @Query("availableOnly") availableOnly?: string,
  ) {
    return {
      items: await this.svc.listSlots(ctx, {
        storeId,
        professionalId,
        startDate,
        endDate,
        availableOnly: availableOnly === "true",
      }),
    };
  }

  @Patch("slots/:id/block")
  @RequirePermission("agenda.edit")
  async blockSlot(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ) {
    return { slot: await this.svc.blockSlot(ctx, id, body.reason ?? "manual") };
  }

  // pendências (follow-ups de cancelamento)
  @Get("followups")
  @RequirePermission("agenda.view")
  async listFollowups(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.listFollowups(ctx, { status }) };
  }

  @Patch("followups/:id")
  @RequirePermission("agenda.edit")
  async resolveFollowup(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ status: z.enum(["done", "dismissed"]) }).parse(body);
    return { followup: await this.svc.resolveFollowup(ctx, id, input.status) };
  }

  /** Envia ao cliente a próxima data com agenda disponível (em vez de redirecionar). */
  @Post("followups/:id/notify-next")
  @HttpCode(200)
  @RequirePermission("agenda.edit")
  async notifyNext(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.notifyNextSlot(ctx, id);
  }
}
