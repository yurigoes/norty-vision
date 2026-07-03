import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PlatformContractsService } from "./platform-contracts.service";

const TemplateSchema = z.object({
  version: z.string().min(1).max(50),
  title: z.string().min(3).max(200),
  description: z.string().max(500).nullable().optional(),
  bodyMarkdown: z.string().min(10),
  kind: z.enum(["onboarding", "aditivo", "servico_extra", "plataforma_uso", "responsabilidade_financeira", "aditivo_modulo"]).optional(),
  isActive: z.boolean().optional(),
});

function clientIp(req: FastifyRequest): string | null {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

@Controller()
export class PlatformContractsController {
  constructor(private readonly svc: PlatformContractsService) {}

  // ===== MASTER =====
  @Get("platform/contract-templates")
  async listTemplates(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTemplates(ctx) };
  }
  @Post("platform/contract-templates")
  @HttpCode(201)
  async createTemplate(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { template: await this.svc.createTemplate(ctx, TemplateSchema.parse(body)) };
  }
  @Patch("platform/contract-templates/:id")
  async updateTemplate(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { template: await this.svc.updateTemplate(ctx, id, TemplateSchema.partial().parse(body)) };
  }

  @Get("platform/contracts")
  async listContracts(@CurrentContext() ctx: RequestContext, @Query("organizationId") organizationId?: string, @Query("status") status?: string) {
    return { items: await this.svc.listContracts(ctx, { organizationId, status }) };
  }
  @Post("platform/contracts")
  @HttpCode(201)
  async assign(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ organizationId: z.string().uuid(), templateId: z.string().uuid(), moduleKey: z.string().max(40).nullable().optional() }).parse(body);
    return { contract: await this.svc.assign(ctx, input) };
  }
  @Patch("platform/contracts/:id/cancel")
  async cancel(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { contract: await this.svc.cancel(ctx, id) };
  }

  // ===== EMPRESA (org admin) =====
  @Get("org-contracts")
  async forOrg(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.forOrg(ctx) };
  }
  @Get("org-contracts/:id/html")
  async html(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.html(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }
  @Post("org-contracts/:id/accept")
  @HttpCode(200)
  async accept(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = z.object({ name: z.string().min(3).max(160), doc: z.string().max(20).nullable().optional() }).parse(body);
    return { contract: await this.svc.accept(ctx, id, input, clientIp(req), req.headers["user-agent"] ?? null) };
  }

  // master também visualiza o HTML do contrato pela mesma rota? usa /org-contracts? não.
  @Get("platform/contracts/:id/html")
  async masterHtml(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.html(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }
}
