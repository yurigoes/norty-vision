import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, Public, RequirePlatformAdmin } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { OrganizationsService } from "./organizations.service";

const IMG_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

const BrandingSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor deve ser hex #RRGGBB")
    .nullable()
    .optional(),
  themeMode: z.enum(["light", "dark", "system"]).optional(),
});

// recursos configuráveis do portal do cliente (null = padrão, mostra todos)
const PORTAL_FEATURES = ["crediario", "os", "pedidos", "chamados", "contratos"] as const;
const PortalSchema = z.object({
  features: z.array(z.enum(PORTAL_FEATURES)).nullable(),
});

// botões do call center (atendimento) configuráveis por empresa
const CALLCENTER_BUTTONS = ["vender", "agenda"] as const;
const CallcenterSchema = z.object({
  buttons: z.array(z.enum(CALLCENTER_BUTTONS)).nullable(),
});

const VitrineSchema = z.object({
  vitrineHeadline: z.string().max(140).nullable().optional(),
  vitrineSubheadline: z.string().max(240).nullable().optional(),
  vitrineAbout: z.string().max(2000).nullable().optional(),
  bannerImageUrl: z.string().url().nullable().optional(),
  bannerLinkUrl: z.string().url().nullable().optional(),
  bannerEnabled: z.boolean().optional(),
  bannerStartsAt: z.string().datetime().nullable().optional(),
  bannerEndsAt: z.string().datetime().nullable().optional(),
  vitrineAddress: z.string().max(300).nullable().optional(),
  vitrineMapsUrl: z.string().url().nullable().optional(),
  vitrineHours: z.string().max(500).nullable().optional(),
  socialInstagram: z.string().max(200).nullable().optional(),
  socialFacebook: z.string().max(200).nullable().optional(),
  socialWhatsapp: z.string().max(30).nullable().optional(),
  socialWebsite: z.string().url().nullable().optional(),
});

const UpdateOrgSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  legalName: z.string().max(200).nullable().optional(),
  document: z.string().max(20).nullable().optional(),
  documentType: z.enum(["cnpj", "cpf"]).nullable().optional(),
  contactEmail: z.string().email().max(320).nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  status: z.enum(["active", "suspended", "trialing", "canceled"]).optional(),
  planCode: z.string().max(40).optional(),
  defaultLocale: z.string().max(10).optional(),
  defaultTimezone: z.string().max(60).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  themeMode: z.enum(["light", "dark", "system"]).optional(),
  portalConfig: z.array(z.enum(PORTAL_FEATURES)).nullable().optional(),
  callcenterConfig: z.array(z.enum(CALLCENTER_BUTTONS)).nullable().optional(),
  maxExtraWhatsapp: z.coerce.number().int().min(0).max(50).optional(),
  niche: z.string().max(40).nullable().optional(),
});

const CreateOrgInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2).max(120),
  legalName: z.string().max(200).nullable().optional(),
  document: z.string().max(20).nullable().optional(),
  documentType: z.enum(["cnpj", "cpf"]).nullable().optional(),
  contactEmail: z.string().email().max(320).nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  niche: z.string().max(40).nullable().optional(),
  firstUser: z.object({
    email: z.string().email().max(320),
    name: z.string().min(2).max(120),
    password: z
      .string()
      .min(12)
      .max(256)
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
        message: "Inclua maiuscula, minuscula e numero",
      }),
  }),
  firstStore: z.object({
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
    name: z.string().min(2).max(120),
    city: z.string().max(80).nullable().optional(),
    state: z.string().length(2).nullable().optional(),
    timezone: z.string().default("America/Sao_Paulo"),
  }),
  autoProvision: z.boolean().default(true),
});

@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly svc: OrganizationsService,
    private readonly storage: StorageService,
  ) {}

  /** Branding da org atual (logo do contratante + cor). */
  @Get("me")
  async getMine(@CurrentContext() ctx: RequestContext) {
    return { organization: await this.svc.getMine(ctx) };
  }

  /** Atualiza logo/cor da org (admin da empresa ou master). */
  @Patch("me/branding")
  async updateBranding(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    return {
      organization: await this.svc.updateBranding(ctx, BrandingSchema.parse(body)),
    };
  }

  /** Upload da logo da org (multipart). */
  @Post("me/logo")
  async uploadLogo(
    @CurrentContext() ctx: RequestContext,
    @Req() req: FastifyRequest,
  ) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!IMG_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 4 * 1024 * 1024) {
      throw new AppError(ErrorCode.ValidationFailed, "Logo maior que 4MB", 413);
    }
    const { url } = await this.storage.putPublic({
      keyPrefix: `org-branding/${ctx.orgId}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    await this.svc.updateBranding(ctx, { logoUrl: url });
    return { ok: true, url };
  }

  /**
   * Identidade pública de uma empresa pelo slug (sem auth).
   * Usado por: vitrine no subdomínio, landing da loja e telas de login
   * com marca (portal do cliente/funcionário/fornecedor scoped por slug).
   * Rota com 3 segmentos → não colide com @Get(":id").
   */
  @Public()
  @Get("public/by-slug/:slug")
  async publicBySlug(@Param("slug") slug: string) {
    return { organization: await this.svc.getPublicBySlug(slug) };
  }

  /** Configura quais recursos aparecem no portal do cliente desta empresa. */
  @Patch("me/portal")
  async updatePortal(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = PortalSchema.parse(body);
    return { organization: await this.svc.updatePortal(ctx, input.features) };
  }

  /** Configura quais botões aparecem no Atendimento (call center) desta empresa. */
  @Patch("me/callcenter")
  async updateCallcenter(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = CallcenterSchema.parse(body);
    return { organization: await this.svc.updateCallcenter(ctx, input.buttons) };
  }

  /** Atualiza a vitrine/landing da empresa (frase de efeito, sobre, banner). */
  @Patch("me/vitrine")
  async updateVitrine(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = VitrineSchema.parse(body);
    return { vitrine: await this.svc.updateVitrine(ctx, input) };
  }

  /** Upload da imagem do banner promocional (multipart). */
  @Post("me/banner")
  async uploadBanner(@CurrentContext() ctx: RequestContext, @Req() req: FastifyRequest) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!IMG_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 6 * 1024 * 1024) {
      throw new AppError(ErrorCode.ValidationFailed, "Banner maior que 6MB", 413);
    }
    const { url } = await this.storage.putPublic({
      keyPrefix: `org-banner/${ctx.orgId}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    await this.svc.updateVitrine(ctx, { bannerImageUrl: url });
    return { ok: true, url };
  }

  @RequirePlatformAdmin()
  @Get()
  async list() {
    return { items: await this.svc.listAll() };
  }

  @RequirePlatformAdmin()
  @Get(":id")
  async getById(@Param("id") id: string) {
    const org = await this.svc.getById(id);
    return { organization: org };
  }

  /** PATCH /api/organizations/:id — master edita todos os dados da org. */
  @RequirePlatformAdmin()
  @Patch(":id")
  async updateById(@Param("id") id: string, @Body() body: unknown) {
    const input = UpdateOrgSchema.parse(body);
    return { organization: await this.svc.updateById(id, input) };
  }

  /**
   * POST /api/organizations
   *
   * Cria org + primeira store + primeiro user (owner) + membership.
   * Se autoProvision=true, dispara provisioning em Chatwoot/GLPI/Evolution.
   * Apenas master.
   */
  @RequirePlatformAdmin()
  @Post()
  @HttpCode(201)
  async create(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = CreateOrgInput.parse(body);
    return this.svc.create({
      platformUserId: ctx.platformUserId!,
      input,
    });
  }
}
