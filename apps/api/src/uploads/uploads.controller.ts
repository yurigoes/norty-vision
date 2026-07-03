import {
  Controller,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { RequirePlatformAdmin, CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { StorageService } from "../storage/storage.service";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
// uploads de empresa (foto de produto, NF, comprovantes): imagens + PDF
const ALLOWED_ORG_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  // áudio do atendimento (gravação no navegador) + anexos comuns
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB (áudios/anexos)

@Controller("uploads")
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  /**
   * POST /api/uploads/platform
   * multipart/form-data:
   *   - file: imagem
   *   - purpose: "logoUrl" | "logoDarkUrl" | "faviconUrl" | "ogImageUrl"
   *
   * Apenas master. Sobe pro bucket publico, devolve URL navegavel.
   */
  @RequirePlatformAdmin()
  @Post("platform")
  async uploadPlatform(@Req() req: FastifyRequest) {
    const data = await (req as any).file();
    if (!data) {
      throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);
    }

    const mime = String(data.mimetype || "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        `Tipo de arquivo nao permitido: ${mime}. Aceitos: PNG, JPG, WEBP, GIF, SVG, ICO.`,
        400,
      );
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) {
      throw new AppError(ErrorCode.ValidationFailed, "Arquivo vazio", 400);
    }
    if (buffer.length > MAX_BYTES) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB`,
        413,
      );
    }

    const purpose = String((data.fields as any)?.purpose?.value || "branding");
    const safePurpose = /^[a-zA-Z0-9_-]{1,40}$/.test(purpose) ? purpose : "branding";

    const { url, key } = await this.storage.putPublic({
      keyPrefix: `platform/${safePurpose}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });

    return { ok: true, url, key };
  }

  /**
   * POST /api/uploads/org — upload de arquivo da empresa (imagem ou PDF).
   * Usado p/ foto de produto, nota fiscal e comprovantes. Requer sessão.
   */
  @Post("org")
  async uploadOrg(@CurrentContext() ctx: RequestContext, @Req() req: FastifyRequest) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    const data = await (req as any).file();
    if (!data) throw new AppError(ErrorCode.ValidationFailed, "Arquivo nao enviado", 400);

    const mime = String(data.mimetype || "").toLowerCase();
    if (!ALLOWED_ORG_MIME.has(mime)) {
      throw new AppError(ErrorCode.ValidationFailed, `Tipo não permitido: ${mime}. Aceitos: PNG, JPG, WEBP, PDF.`, 400);
    }
    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Arquivo vazio", 400);
    if (buffer.length > MAX_BYTES) {
      throw new AppError(ErrorCode.ValidationFailed, `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB`, 413);
    }

    const purpose = String((data.fields as any)?.purpose?.value || "doc");
    const safePurpose = /^[a-zA-Z0-9_-]{1,40}$/.test(purpose) ? purpose : "doc";
    const orgKey = ctx.orgId ?? "platform";

    const { url, key } = await this.storage.putPublic({
      keyPrefix: `org/${orgKey}/${safePurpose}`,
      contentType: mime,
      body: buffer,
      originalName: data.filename,
    });
    return { ok: true, url, key };
  }
}
