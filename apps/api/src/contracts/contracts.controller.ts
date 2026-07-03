import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { CurrentContext, Public, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ContractsService } from "./contracts.service";

const FieldSchemaItem = z.object({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: z.enum([
    "text",
    "email",
    "cpf",
    "cnpj",
    "phone",
    "date",
    "select",
    "textarea",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

const CreateTemplateSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  title: z.string().min(2).max(200),
  description: z.string().max(500).nullable().optional(),
  bodyMarkdown: z.string().min(10),
  fieldsSchema: z.array(FieldSchemaItem),
  signatureMode: z.enum(["click", "draw"]).optional(),
  requiresSignature: z.boolean().optional(),
  kind: z.enum(["generic", "credit"]).optional(),
  biometricRequired: z.boolean().optional(),
});

const UpdateTemplateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  bodyMarkdown: z.string().min(10).optional(),
  fieldsSchema: z.array(FieldSchemaItem).optional(),
  signatureMode: z.enum(["click", "draw"]).optional(),
  requiresSignature: z.boolean().optional(),
  isActive: z.boolean().optional(),
  kind: z.enum(["generic", "credit"]).optional(),
  biometricRequired: z.boolean().optional(),
});

const CreateForAccountSchema = z.object({
  creditAccountId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
});

const CreateContractSchema = z.object({
  templateId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  storeId: z.string().uuid().nullable().optional(),
  signerEmail: z.string().email().optional(),
  signerName: z.string().min(2).max(120).optional(),
  signerDocument: z.string().max(20).optional(),
  signerPhone: z.string().max(30).optional(),
  fieldValues: z.record(z.unknown()).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  customerId: z.string().uuid().nullable().optional(),
});

const SignContractSchema = z.object({
  fieldValues: z.record(z.unknown()),
  signerName: z.string().min(2).max(120),
  signerEmail: z.string().email(),
  signerDocument: z.string().max(20).optional(),
  signerPhone: z.string().max(30).optional(),
  signatureImageUrl: z.string().url().optional(),
});

@Controller("contracts")
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  // ===== TEMPLATES =====
  @Get("templates")
  @RequirePermission("contracts.view")
  async listTemplates(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listTemplates(ctx) };
  }

  @Get("templates/:id")
  @RequirePermission("contracts.view")
  async getTemplate(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { template: await this.svc.getTemplate(ctx, id) };
  }

  @Post("templates")
  @HttpCode(201)
  @RequirePermission("contracts.manage")
  async createTemplate(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = CreateTemplateSchema.parse(body);
    return { template: await this.svc.createTemplate(ctx, input) };
  }

  @Patch("templates/:id")
  @RequirePermission("contracts.manage")
  async updateTemplate(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateTemplateSchema.parse(body);
    return { template: await this.svc.updateTemplate(ctx, id, input) };
  }

  // ===== CONTRACTS =====
  @Get()
  @RequirePermission("contracts.view")
  async list(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listContracts(ctx) };
  }

  @Get(":id")
  @RequirePermission("contracts.view")
  async getById(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { contract: await this.svc.getContract(ctx, id) };
  }

  /** HTML standalone com branding da empresa, pronto pra imprimir/baixar. */
  @Get(":id/html")
  @RequirePermission("contracts.view")
  async html(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.svc.renderHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("contracts.sign")
  async create(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = CreateContractSchema.parse(body);
    return { contract: await this.svc.createContract(ctx, input) };
  }

  @Patch(":id/cancel")
  @RequirePermission("contracts.manage")
  async cancel(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { contract: await this.svc.cancel(ctx, id) };
  }

  // ===== CREDIARIO =====
  /** Cria/garante contrato de crediario pra uma conta (assinado no portal). */
  @Post("for-account")
  @HttpCode(201)
  @RequirePermission("contracts.sign")
  async createForAccount(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = CreateForAccountSchema.parse(body);
    return { contract: await this.svc.createForAccount(ctx, input) };
  }

  @Get("by-account/:accountId")
  @RequirePermission("contracts.view")
  async byAccount(
    @CurrentContext() ctx: RequestContext,
    @Param("accountId") accountId: string,
  ) {
    return { items: await this.svc.listByAccount(accountId) };
  }

  // ===== PUBLICO (sem auth) =====
  @Public()
  @Get("by-token/:token")
  async getByToken(@Param("token") token: string) {
    const c = await this.svc.getByToken(token);
    // omite campos sensiveis pra rota publica
    return {
      contract: {
        id: c.id,
        status: c.status,
        signerName: c.signerName,
        signerEmail: c.signerEmail,
        signerDocument: c.signerDocument,
        fieldValues: c.fieldValues,
        signedAt: c.signedAt,
        tokenExpiresAt: c.tokenExpiresAt,
        template: {
          id: c.template.id,
          title: c.template.title,
          description: c.template.description,
          bodyMarkdown: c.template.bodyMarkdown,
          fieldsSchema: c.template.fieldsSchema,
          signatureMode: c.template.signatureMode,
        },
      },
    };
  }

  /** HTML formatado do contrato pra preview na página pública de assinatura. */
  @Public()
  @Get("by-token/:token/html")
  async htmlByToken(@Param("token") token: string, @Res() reply: FastifyReply) {
    const html = await this.svc.renderHtmlByToken(token);
    reply.type("text/html; charset=utf-8").send(html);
  }

  @Public()
  @Post("by-token/:token/sign")
  @HttpCode(200)
  async sign(
    @Param("token") token: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const input = SignContractSchema.parse(body);
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.ip ??
      undefined;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? undefined;
    const signed = await this.svc.sign({
      token,
      ...input,
      ip,
      userAgent,
    });
    return {
      contract: {
        id: signed.id,
        status: signed.status,
        signedAt: signed.signedAt,
      },
    };
  }
}
