import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Public } from "../auth/decorators";
import { RateLimitService } from "../redis/rate-limit.service";
import { AppointmentsService } from "./appointments.service";

function clientIp(req: FastifyRequest): string {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "unknown";
}

/**
 * Portal público do agendamento (sem login). O cliente abre /a/{code} e pode
 * confirmar, reagendar ou cancelar. Autorização = posse do shortCode.
 * Rate-limit por IP para dificultar brute force no código.
 */
@Controller("public/appointments")
export class PublicAppointmentsController {
  constructor(
    private readonly svc: AppointmentsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get(":code")
  async get(@Req() req: FastifyRequest, @Param("code") code: string) {
    // leitura: 30 / min por IP (trava tentativa de adivinhar códigos)
    await this.rateLimit.enforce(`appt-get:${clientIp(req)}`, 30, 60);
    return this.svc.publicGet(code);
  }

  @Public()
  @Post(":code/confirm")
  @HttpCode(200)
  async confirm(@Req() req: FastifyRequest, @Param("code") code: string) {
    await this.rateLimit.enforce(`appt-act:${clientIp(req)}`, 20, 60);
    return this.svc.publicConfirm(code);
  }

  @Public()
  @Post(":code/cancel")
  @HttpCode(200)
  async cancel(@Req() req: FastifyRequest, @Param("code") code: string) {
    await this.rateLimit.enforce(`appt-act:${clientIp(req)}`, 20, 60);
    return this.svc.publicCancel(code);
  }

  @Public()
  @Get(":code/reschedule-options")
  async options(@Req() req: FastifyRequest, @Param("code") code: string) {
    await this.rateLimit.enforce(`appt-get:${clientIp(req)}`, 30, 60);
    return this.svc.publicRescheduleOptions(code);
  }

  @Public()
  @Post(":code/reschedule")
  @HttpCode(200)
  async reschedule(@Req() req: FastifyRequest, @Param("code") code: string, @Body() body: unknown) {
    await this.rateLimit.enforce(`appt-act:${clientIp(req)}`, 20, 60);
    const input = z.object({ newSlotId: z.string().uuid() }).parse(body);
    return this.svc.publicReschedule(code, input.newSlotId);
  }
}
