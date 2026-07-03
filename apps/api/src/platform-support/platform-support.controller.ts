import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PlatformSupportService } from "./platform-support.service";

@Controller("platform-support")
export class PlatformSupportController {
  constructor(private readonly svc: PlatformSupportService) {}

  // ---------- empresa ----------
  @Get("tickets")
  async listMine(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listMine(ctx) }; }

  @Post("tickets")
  @HttpCode(201)
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ category: z.string().optional(), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }).parse(body);
    return { ticket: await this.svc.create(ctx, input) };
  }

  @Get("tickets/:id")
  async get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { ticket: await this.svc.getTicket(ctx, id) }; }

  @Post("tickets/:id/message")
  @HttpCode(200)
  async message(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ body: z.string().min(1).max(5000) }).parse(body);
    return { ticket: await this.svc.addUserMessage(ctx, id, input.body) };
  }

  // ---------- autoatendimento seguro ----------
  @Get("tickets/:id/secure-info")
  async secureInfo(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.secureInfo(ctx, id); }

  @Post("tickets/:id/password-self")
  @HttpCode(200)
  async passwordSelf(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).parse(body);
    return this.svc.changePasswordSelf(ctx, id, input.currentPassword, input.newPassword);
  }

  @Post("tickets/:id/otp")
  @HttpCode(200)
  async otp(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ action: z.enum(["password_change", "email_change", "phone_change"]), channel: z.enum(["whatsapp", "email"]) }).parse(body);
    return this.svc.requestOtp(ctx, id, input.action, input.channel);
  }

  @Post("tickets/:id/otp/apply")
  @HttpCode(200)
  async otpApply(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ action: z.enum(["password_change", "email_change", "phone_change"]), requestId: z.string().uuid(), code: z.string().min(4).max(8), newValue: z.string().min(1).max(200) }).parse(body);
    return this.svc.applyWithOtp(ctx, id, input.action, input.requestId, input.code, input.newValue);
  }

  @Post("tickets/:id/no-access")
  @HttpCode(200)
  async noAccess(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { ticket: await this.svc.escalateNoAccess(ctx, id) }; }

  // ---------- master ----------
  @Get("master/tickets")
  async masterList(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) { return { items: await this.svc.masterList(ctx, { status }) }; }

  @Get("master/tickets/:id")
  async masterGet(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { ticket: await this.svc.getTicket(ctx, id, { master: true }) }; }

  @Post("master/tickets/:id/reply")
  @HttpCode(200)
  async masterReply(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ body: z.string().min(1).max(5000), internal: z.boolean().optional(), resolve: z.boolean().optional() }).parse(body);
    return { ticket: await this.svc.masterReply(ctx, id, input.body, { internal: input.internal, resolve: input.resolve }) };
  }
}
