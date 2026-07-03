import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { StoresService } from "./stores.service";

const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon"]);

const CreateStoreSchema = z.object({
  organizationId: z.string().uuid().optional(),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(120),
  document: z.string().max(20).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  timezone: z.string().optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
const UpdateStoreSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  document: z.string().max(20).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  timezone: z.string().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  themePrimaryColor: hexColor,
  themeSecondaryColor: hexColor,
  themeAccentColor: hexColor,
  logoUrl: z.string().url().nullable().optional(),
  logoDarkUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  themeMode: z.enum(["light", "dark", "system"]).optional(),
  examPriceCents: z.number().int().min(0).optional(),
  examPaymentNote: z.string().max(120).optional(),
});

@Controller("stores")
export class StoresController {
  constructor(
    private readonly svc: StoresService,
    private readonly storage: StorageService,
  ) {}

  @Post(":id/logo")
  @RequirePermission("stores.manage")
  async uploadLogo(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Req() req: FastifyRequest,
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!LOGO_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 4 * 1024 * 1024) {
      throw new AppError(ErrorCode.ValidationFailed, "Logo maior que 4MB", 413);
    }
    const { url } = await this.storage.putPublic({
      keyPrefix: `stores/${id}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    return { ok: true, url };
  }

  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query("organizationId") organizationId?: string,
  ) {
    // Leitura é livre (qualquer user da org precisa saber em qual loja está)
    const items = await this.svc.list(ctx, { organizationId });
    return { items };
  }

  @Get(":id")
  async getById(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { store: await this.svc.getById(ctx, id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("stores.manage")
  async create(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = CreateStoreSchema.parse(body);
    return { store: await this.svc.create(ctx, input) };
  }

  @Patch(":id")
  @RequirePermission("stores.manage")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateStoreSchema.parse(body);
    return { store: await this.svc.update(ctx, id, input) };
  }

  @Delete(":id")
  @RequirePermission("stores.manage")
  async remove(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return { store: await this.svc.softDelete(ctx, id) };
  }
}
