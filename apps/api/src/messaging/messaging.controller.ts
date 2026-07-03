import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { MessagingService } from "./messaging.service";

const UpsertTemplateSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  code: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  category: z.enum(["info", "low", "warning", "critical"]).optional(),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(8000),
  isActive: z.boolean().optional(),
});

const PreviewSchema = z.object({
  templateId: z.string().uuid().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  category: z.enum(["info", "low", "warning", "critical"]).optional(),
});

const SmtpSchema = z.object({
  host: z.string().max(200).nullable().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().max(200).nullable().optional(),
  password: z.string().max(500).nullable().optional(),
  fromName: z.string().max(120).nullable().optional(),
  fromEmail: z.string().email().max(200).nullable().optional(),
  replyTo: z.string().email().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

const TestSchema = z.object({
  to: z.string().min(3).max(200),
  templateId: z.string().uuid().optional(),
});

@Controller("messaging")
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get("templates")
  @RequirePermission("templates.manage")
  async listTemplates(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTemplates(ctx) };
  }

  @Get("variables")
  async variables() {
    // catálogo de variáveis: livre — todo mundo consulta pra escrever
    return { groups: this.svc.variablesCatalog() };
  }

  /** Modelos automáticos do sistema (pra personalizar na aba Mensagens). */
  @Get("system-templates")
  @RequirePermission("templates.manage")
  async systemTemplates() {
    return { items: this.svc.systemTemplatesCatalog() };
  }

  @Post("preview")
  @HttpCode(200)
  @RequirePermission("templates.manage")
  async preview(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.previewEmail(ctx, PreviewSchema.parse(body));
  }

  @Post("templates")
  @HttpCode(201)
  @RequirePermission("templates.manage")
  async upsertTemplate(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { template: await this.svc.upsertTemplate(ctx, UpsertTemplateSchema.parse(body)) };
  }

  @Delete("templates/:id")
  @RequirePermission("templates.manage")
  async deleteTemplate(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteTemplate(ctx, id);
  }

  @Get("smtp")
  @RequirePermission("integrations.manage")
  async getSmtp(@CurrentContext() ctx: RequestContext) {
    return { smtp: await this.svc.getSmtp(ctx) };
  }

  @Patch("smtp")
  @RequirePermission("integrations.manage")
  async upsertSmtp(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { smtp: await this.svc.upsertSmtp(ctx, SmtpSchema.parse(body)) };
  }

  @Post("test/email")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async testEmail(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.testEmail(ctx, TestSchema.parse(body));
  }

  @Post("test/whatsapp")
  @HttpCode(200)
  @RequirePermission("integrations.manage")
  async testWhatsapp(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.testWhatsapp(ctx, TestSchema.parse(body));
  }
}
