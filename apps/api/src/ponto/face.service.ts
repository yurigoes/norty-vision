import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../auth/session.middleware";

export type FaceConfig = { faceProvider: string; faceProviderUrl: string | null; faceProviderKey: string | null; faceThreshold: number; requireFace: boolean; requireLiveness: boolean; faceEnforce: boolean } | null;
export type FaceResult = { score: number | null; match: boolean | null };

/**
 * Reconhecimento facial PLUGÁVEL. provider='none' desliga; provider='http' chama um
 * serviço externo self-hosted (CompreFace/DeepFace) ou adaptador (AWS Rekognition):
 *   POST <faceProviderUrl>  body { reference: <base64>, probe: <base64> }  header x-api-key
 *   resposta { similarity: number }  (0..1 ou 0..100)
 * Trocar de provider = só configurar a URL; nada acoplado a um fornecedor específico.
 */
@Injectable()
export class FaceService {
  private readonly logger = new Logger("PontoFace");
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private parseDataUrl(s: string): { contentType: string; buf: Buffer } {
    const m = s.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Imagem inválida", 400);
    const buf = Buffer.from(m[2]!, "base64");
    if (buf.length > 4_000_000) throw new AppError(ErrorCode.ValidationFailed, "Imagem muito grande", 400);
    return { contentType: m[1]!, buf };
  }

  /** Enrolla (cadastra) o rosto de referência do funcionário no bucket privado. */
  async enroll(ctx: RequestContext, employeeId: string, selfieDataUrl: string) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const { contentType, buf } = this.parseDataUrl(selfieDataUrl);
    const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/faces/${ctx.orgId}`, contentType, body: buf });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.update({ where: { id: employeeId }, data: { faceRefKey: key, faceEnrolledAt: new Date() } }));
    return { ok: true };
  }

  /** Verifica a probe (selfie da marcação) contra o rosto de referência do funcionário. */
  async verify(cfg: FaceConfig, refKey: string | null, probe: Buffer): Promise<FaceResult> {
    if (!cfg || cfg.faceProvider === "none" || !cfg.faceProviderUrl || !refKey) return { score: null, match: null };
    let reference: Buffer;
    try { reference = (await this.storage.getPrivate(refKey)).body; } catch { return { score: null, match: null }; }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(cfg.faceProviderUrl, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(cfg.faceProviderKey ? { "x-api-key": cfg.faceProviderKey } : {}) },
        body: JSON.stringify({ reference: reference.toString("base64"), probe: probe.toString("base64") }),
      });
      clearTimeout(t);
      if (!res.ok) { this.logger.warn(`face provider ${res.status}`); return { score: null, match: null }; }
      const d = (await res.json().catch(() => null)) as any;
      let sim = Number(d?.similarity);
      if (!isFinite(sim)) return { score: null, match: null };
      if (sim <= 1) sim *= 100; // normaliza 0..1 → 0..100
      sim = Math.max(0, Math.min(100, sim));
      return { score: Math.round(sim * 10) / 10, match: sim >= cfg.faceThreshold };
    } catch (e) {
      this.logger.warn(`face verify falhou: ${(e as Error).message}`);
      return { score: null, match: null };
    }
  }

  /** 1:N — manda a probe + candidatos (ref em base64) e recebe o melhor match. */
  async identify(cfg: FaceConfig, candidates: { id: string; image: string }[], probe: Buffer): Promise<{ id: string | null; score: number | null }> {
    if (!cfg || cfg.faceProvider === "none" || !cfg.faceProviderUrl || !candidates.length) return { id: null, score: null };
    const url = cfg.faceProviderUrl.replace(/\/verify\/?$/, "") + "/identify";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(cfg.faceProviderKey ? { "x-api-key": cfg.faceProviderKey } : {}) },
        body: JSON.stringify({ probe: probe.toString("base64"), candidates }),
      });
      clearTimeout(t);
      if (!res.ok) return { id: null, score: null };
      const d = (await res.json().catch(() => null)) as any;
      let sim = Number(d?.similarity);
      if (!isFinite(sim)) return { id: null, score: null };
      if (sim <= 1) sim *= 100;
      sim = Math.max(0, Math.min(100, sim));
      return { id: d?.id ?? null, score: Math.round(sim * 10) / 10 };
    } catch (e) {
      this.logger.warn(`face identify falhou: ${(e as Error).message}`);
      return { id: null, score: null };
    }
  }
}
