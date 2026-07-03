import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";
import { BroadcastService } from "./broadcast.service";

const IMG_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const SendSchema = z.object({
  channel: z.enum(["email", "whatsapp", "both"]),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().max(8000),
  imageUrl: z.string().url().nullable().optional(),
  category: z.enum(["info", "low", "warning", "critical"]).optional(),
});

@Controller("broadcast")
export class BroadcastController {
  constructor(
    private readonly svc: BroadcastService,
    private readonly storage: StorageService,
  ) {}

  @Post("send")
  @HttpCode(200)
  @RequirePermission("broadcast.send")
  async send(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.send(ctx, SendSchema.parse(body));
  }

  @Get("status")
  @RequirePermission("broadcast.view")
  async status(@CurrentContext() ctx: RequestContext) {
    return this.svc.status(ctx);
  }

  /** Upload da imagem da campanha (WhatsApp). */
  @Post("image")
  @HttpCode(200)
  @RequirePermission("broadcast.send")
  async image(@CurrentContext() ctx: RequestContext, @Req() req: FastifyRequest) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    const mime = String(data.mimetype || "").toLowerCase();
    if (!IMG_MIME.has(mime)) throw new AppError(ErrorCode.ValidationFailed, `Tipo nao permitido: ${mime}`, 400);
    const buffer = await data.toBuffer();
    if (buffer.length > 6 * 1024 * 1024) throw new AppError(ErrorCode.ValidationFailed, "Imagem maior que 6MB", 413);
    const { url } = await this.storage.putPublic({
      keyPrefix: `broadcast/${ctx.orgId}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    return { ok: true, url };
  }
}
