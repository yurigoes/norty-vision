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
import { AppointmentsService } from "./appointments.service";

const CreateSchema = z.object({
  slotId: z.string().uuid(),
  customerId: z.string().uuid(),
  serviceName: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  allowPast: z.boolean().optional(),
});

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
  actor: z.enum(["customer", "staff", "no_show", "system"]).optional(),
});

const RescheduleSchema = z.object({
  newSlotId: z.string().uuid(),
  actor: z.enum(["customer", "staff"]).optional(),
});

@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get()
  @RequirePermission("agenda.view")
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("storeId") storeId?: string,
    @Query("professionalId") professionalId?: string,
    @Query("customerId") customerId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("status") status?: string,
  ) {
    return {
      items: await this.svc.list(ctx, {
        storeId,
        professionalId,
        customerId,
        startDate,
        endDate,
        status,
      }),
    };
  }

  /** Relatório: quantos dias faltam pra notificar o recall de exame de cada cliente. */
  @Get("reports/exam-recall")
  @RequirePermission("agenda.view")
  async examRecallReport(@CurrentContext() ctx: RequestContext) {
    return this.svc.examRecallReport(ctx);
  }

  @Get(":id")
  @RequirePermission("agenda.view")
  async getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { appointment: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("agenda.create")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = CreateSchema.parse(body);
    return { appointment: await this.svc.create(ctx, input) };
  }

  @Patch(":id/confirm")
  @RequirePermission("agenda.edit")
  async confirm(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { appointment: await this.svc.confirm(ctx, id) };
  }

  @Patch(":id/cancel")
  @RequirePermission("agenda.cancel")
  async cancel(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = CancelSchema.parse(body ?? {});
    return { appointment: await this.svc.cancel(ctx, id, input) };
  }

  @Patch(":id/reschedule")
  @RequirePermission("agenda.edit")
  async reschedule(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = RescheduleSchema.parse(body);
    return {
      appointment: await this.svc.reschedule(ctx, id, input.newSlotId, input.actor),
    };
  }

  @Patch(":id/check-in")
  @RequirePermission("agenda.edit")
  async checkIn(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { appointment: await this.svc.checkIn(ctx, id) };
  }

  @Patch(":id/attended")
  @RequirePermission("agenda.edit")
  async attended(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { appointment: await this.svc.markAttended(ctx, id) };
  }
}
