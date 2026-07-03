import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PontoService } from "./ponto.service";
import { FaceService } from "./face.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * PWA de ponto por DISPOSITIVO (tablet no balcão da filial). O dispositivo tem um
 * token próprio; o funcionário bate o ponto com PIN + GPS (geofence) + selfie, sem
 * login de usuário. Endpoints públicos validam o token; admin gerencia os devices.
 */
@Injectable()
export class PontoPwaService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly ponto: PontoService, private readonly face: FaceService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private hash(s: string) { return createHash("sha256").update(s, "utf8").digest("hex"); }

  // ----- ADMIN: dispositivos -----
  async listDevices(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.findMany({ where: {}, orderBy: { createdAt: "desc" } }));
    return rows.map((d) => ({ id: d.id, name: d.name, storeId: d.storeId, geoLat: d.geoLat, geoLng: d.geoLng, geoRadiusM: d.geoRadiusM, requireGeo: d.requireGeo, requireSelfie: d.requireSelfie, lastSeenAt: d.lastSeenAt, revoked: !!d.revokedAt }));
  }
  async createDevice(ctx: RequestContext, input: { name: string; storeId?: string; geoLat?: number; geoLng?: number; geoRadiusM?: number; requireGeo?: boolean; requireSelfie?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Nome obrigatório", 400);
    const token = randomBytes(24).toString("base64url");
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.create({
      data: {
        organizationId: orgId, name: input.name.trim(), storeId: input.storeId || null,
        tokenHash: this.hash(token),
        geoLat: input.geoLat ?? null, geoLng: input.geoLng ?? null, geoRadiusM: Math.max(20, Math.min(5000, input.geoRadiusM ?? 150)),
        requireGeo: !!input.requireGeo, requireSelfie: !!input.requireSelfie,
      },
    }));
    return { id: row.id, token }; // token cru só aqui
  }
  async updateDevice(ctx: RequestContext, id: string, input: { name?: string; geoLat?: number; geoLng?: number; geoRadiusM?: number; requireGeo?: boolean; requireSelfie?: boolean; revoked?: boolean }) {
    this.requireAdmin(ctx);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.geoLat !== undefined) data.geoLat = input.geoLat;
    if (input.geoLng !== undefined) data.geoLng = input.geoLng;
    if (input.geoRadiusM !== undefined) data.geoRadiusM = Math.max(20, Math.min(5000, input.geoRadiusM));
    if (input.requireGeo !== undefined) data.requireGeo = !!input.requireGeo;
    if (input.requireSelfie !== undefined) data.requireSelfie = !!input.requireSelfie;
    if (input.revoked !== undefined) data.revokedAt = input.revoked ? new Date() : null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.update({ where: { id }, data }));
    return { ok: true };
  }

  // ----- PÚBLICO (token do dispositivo) -----
  private async device(token: string, ip: string | null) {
    if (!token) throw new AppError(ErrorCode.Unauthorized, "Token ausente", 401);
    const d = await this.prisma.runWithContext({ isPlatformAdmin: true },(tx) => tx.pontoDevice.findFirst({ where: { tokenHash: this.hash(token) } }));
    if (!d || d.revokedAt) throw new AppError(ErrorCode.Unauthorized, "Dispositivo inválido ou revogado", 401);
    await this.prisma.runWithContext({ isPlatformAdmin: true },(tx) => tx.pontoDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastSeenIp: ip } }));
    return d;
  }

  async bootstrap(token: string, ip: string | null) {
    const d = await this.device(token, ip);
    const orgId = d.organizationId;
    const [org, cfg, notices, enrolledCount] = await Promise.all([
      this.prisma.runWithContext({ isPlatformAdmin: true },(tx) => tx.organization.findUnique({ where: { id: orgId }, select: { name: true } })),
      this.prisma.runWithContext({ orgId }, (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true, requireFace: true, requireLiveness: true, bgImageUrl: true, bgUntil: true, faceProvider: true } })),
      this.ponto.activeNotices(orgId, null),
      this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.count({ where: { active: true, faceRefKey: { not: null } } })),
    ]);
    // selfie é exigida se o device pede OU se a empresa exige facial/liveness
    const requireSelfie = d.requireSelfie || !!cfg?.requireFace || !!cfg?.requireLiveness;
    const bg = cfg?.bgImageUrl && (!cfg.bgUntil || new Date(cfg.bgUntil) >= new Date()) ? cfg.bgImageUrl : null;
    // "bater pelo rosto" (1:N) disponível quando há provedor facial + ao menos 1 rosto cadastrado
    const faceIdentify = (cfg?.faceProvider ?? "none") !== "none" && enrolledCount > 0;
    // NÃO devolvemos a lista de funcionários (privacidade): a identificação é por código/CPF/matrícula/rosto.
    return {
      device: { name: d.name, requireGeo: d.requireGeo, requireSelfie, requireLiveness: !!cfg?.requireLiveness, faceIdentify, geo: d.geoLat != null && d.geoLng != null ? { lat: d.geoLat, lng: d.geoLng, radiusM: d.geoRadiusM } : null },
      employer: cfg?.razaoOuNome || org?.name || "",
      bgImageUrl: bg,
      noticesGeral: notices,
    };
  }

  /** Bater ponto por reconhecimento facial (1:N): a selfie identifica o funcionário e marca. */
  async facePunch(token: string, body: { selfie?: string; lat?: number; lng?: number; accuracy?: number; livenessOk?: boolean }, ip: string | null) {
    const d = await this.device(token, ip);
    const orgId = d.organizationId;
    const cfg = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoConfig.findFirst({ where: {} }));
    if (!cfg || cfg.faceProvider === "none") throw new AppError(ErrorCode.ValidationFailed, "Reconhecimento facial não está configurado", 400);
    if (!body.selfie) throw new AppError(ErrorCode.ValidationFailed, "Selfie obrigatória", 400);
    const m = body.selfie.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Selfie inválida", 400);
    const probeBuf = Buffer.from(m[2]!, "base64");
    if (probeBuf.length > 4_000_000) throw new AppError(ErrorCode.ValidationFailed, "Selfie muito grande", 400);
    // geofence
    const flags: string[] = [];
    if (d.requireGeo && d.geoLat != null && d.geoLng != null) {
      if (body.lat == null || body.lng == null) throw new AppError(ErrorCode.ValidationFailed, "Localização obrigatória neste dispositivo", 400);
      const dist = this.distM(d.geoLat, d.geoLng, body.lat, body.lng);
      if (dist > d.geoRadiusM + (body.accuracy ?? 0)) throw new AppError(ErrorCode.Forbidden, `Fora da área permitida (${Math.round(dist)}m do ponto)`, 403);
    }
    if (cfg.requireLiveness && body.livenessOk !== true) throw new AppError(ErrorCode.Forbidden, "Prova de vida não confirmada — mexa o rosto e tente de novo", 403);
    // candidatos = funcionários ativos com rosto cadastrado
    const emps = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findMany({ where: { active: true, faceRefKey: { not: null } }, select: { id: true, name: true, faceRefKey: true } }));
    if (!emps.length) throw new AppError(ErrorCode.NotFound, "Nenhum rosto cadastrado", 404);
    const candidates: { id: string; image: string }[] = [];
    for (const e of emps) {
      try { candidates.push({ id: e.id, image: (await this.storage.getPrivate(e.faceRefKey!)).body.toString("base64") }); } catch { /* ignora ref ilegível */ }
    }
    const r = await this.face.identify(cfg as any, candidates, probeBuf);
    if (!r.id || r.score == null || r.score < cfg.faceThreshold) {
      throw new AppError(ErrorCode.NotFound, "Rosto não reconhecido. Use o código, CPF ou matrícula.", 404);
    }
    const emp = emps.find((e) => e.id === r.id)!;
    if (r.score < cfg.faceThreshold + 8) flags.push("rosto_baixa_confianca"); // reconheceu por pouco → revisar
    const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/selfies/${orgId}`, contentType: m[1]!, body: probeBuf });
    const res = await this.ponto.punchCore(orgId, {
      employeeId: emp.id, origin: "pwa", lat: body.lat, lng: body.lng, accuracy: body.accuracy,
      photoUrl: key, faceScore: r.score, faceMatch: true, livenessOk: cfg.requireLiveness ? !!body.livenessOk : null, fraudFlags: flags,
    }, ip, { device: d.name });
    const notices = await this.ponto.activeNotices(orgId, emp.id);
    return { ...res, employeeName: emp.name, faceScore: r.score, notices };
  }

  /** Identifica o funcionário por código de barras / CPF / matrícula (sem expor a lista). */
  async identify(token: string, identifier: string, ip: string | null) {
    const d = await this.device(token, ip);
    const emp = await this.ponto.resolveIdentifier(d.organizationId, identifier);
    if (!emp) throw new AppError(ErrorCode.NotFound, "Não encontrei esse funcionário. Confira o código, CPF ou matrícula.", 404);
    return emp; // { id, name, requiresPin }
  }

  /** Sobe a imagem de fundo do painel (bucket público) com validade. */
  async setBackground(ctx: RequestContext, dataUrl: string, until?: string) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Imagem inválida", 400);
    const buf = Buffer.from(m[2]!, "base64");
    if (buf.length > 8_000_000) throw new AppError(ErrorCode.ValidationFailed, "Imagem muito grande (máx. 8MB)", 400);
    const { url } = await this.storage.putPublic({ keyPrefix: `ponto/bg/${ctx.orgId}`, contentType: m[1]!, body: buf });
    return this.ponto.updateConfig(ctx, { bgImageUrl: url, bgUntil: until ?? null });
  }

  private distM(aLat: number, aLng: number, bLat: number, bLng: number) {
    const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  async punch(token: string, body: { employeeId: string; pin?: string; lat?: number; lng?: number; accuracy?: number; selfie?: string; offline?: boolean; deviceAt?: string; livenessOk?: boolean }, ip: string | null) {
    const d = await this.device(token, ip);
    const orgId = d.organizationId;
    const cfg = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoConfig.findFirst({ where: {} }));
    const flags: string[] = [];
    // Geofence
    if (d.requireGeo && d.geoLat != null && d.geoLng != null) {
      if (body.lat == null || body.lng == null) throw new AppError(ErrorCode.ValidationFailed, "Localização obrigatória neste dispositivo", 400);
      const dist = this.distM(d.geoLat, d.geoLng, body.lat, body.lng);
      if (dist > d.geoRadiusM + (body.accuracy ?? 0)) throw new AppError(ErrorCode.Forbidden, `Fora da área permitida (${Math.round(dist)}m do ponto)`, 403);
    }
    if (d.requireGeo && body.lat != null && (body.accuracy == null || body.accuracy > 200)) flags.push("gps_impreciso");
    // Prova de vida (liveness) — checada no cliente (multi-frame); aqui validamos a flag
    if (cfg?.requireLiveness && body.livenessOk !== true) throw new AppError(ErrorCode.Forbidden, "Prova de vida não confirmada — mexa o rosto e tente de novo", 403);
    const livenessOk = cfg?.requireLiveness ? !!body.livenessOk : (body.livenessOk ?? null);
    // Selfie
    const needSelfie = d.requireSelfie || !!cfg?.requireFace || !!cfg?.requireLiveness;
    let photoUrl: string | undefined; let probeBuf: Buffer | undefined;
    if (needSelfie && !body.selfie) throw new AppError(ErrorCode.ValidationFailed, "Selfie obrigatória neste dispositivo", 400);
    if (body.selfie) {
      const m = body.selfie.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!m) throw new AppError(ErrorCode.ValidationFailed, "Selfie inválida", 400);
      probeBuf = Buffer.from(m[2]!, "base64");
      if (probeBuf.length > 4_000_000) throw new AppError(ErrorCode.ValidationFailed, "Selfie muito grande", 400);
      const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/selfies/${orgId}`, contentType: m[1]!, body: probeBuf });
      photoUrl = key; // bucket privado: guardamos a key, servida via endpoint autenticado
    }
    // Reconhecimento facial
    let faceScore: number | null = null, faceMatch: boolean | null = null;
    if (cfg?.requireFace && probeBuf) {
      const emp = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findFirst({ where: { id: body.employeeId }, select: { faceRefKey: true } }));
      const r = await this.face.verify(cfg as any, emp?.faceRefKey ?? null, probeBuf);
      faceScore = r.score; faceMatch = r.match;
      if (r.match === false) {
        flags.push("rosto_divergente");
        if (cfg.faceEnforce) throw new AppError(ErrorCode.Forbidden, "Rosto não confere com o cadastro", 403);
      } else if (r.match === null && cfg.faceEnforce) {
        // provider sem resposta / sem rosto cadastrado, mas exige verificação → bloqueia
        throw new AppError(ErrorCode.Forbidden, "Não foi possível verificar o rosto (cadastre o rosto e verifique o serviço facial)", 403);
      } else if (r.match === true && r.score != null && r.score < cfg.faceThreshold + 8) {
        // bateu, mas por pouco → sinaliza pra revisão (não bloqueia)
        flags.push("rosto_baixa_confianca");
      }
    }
    const res = await this.ponto.punchCore(orgId, {
      employeeId: body.employeeId, pin: body.pin, origin: "pwa",
      lat: body.lat, lng: body.lng, accuracy: body.accuracy, photoUrl,
      offline: body.offline, deviceAt: body.deviceAt,
      faceScore, faceMatch, livenessOk, fraudFlags: flags,
    }, ip, { device: d.name });
    const notices = await this.ponto.activeNotices(orgId, body.employeeId);
    return { ...res, notices };
  }

  /** Teste de calibração (admin): identifica o rosto e devolve quem é + similaridade, SEM bater ponto. */
  async faceTest(ctx: RequestContext, selfie: string) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const m = (selfie || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Selfie inválida", 400);
    const probeBuf = Buffer.from(m[2]!, "base64");
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {} }));
    if (!cfg || cfg.faceProvider === "none") throw new AppError(ErrorCode.ValidationFailed, "Reconhecimento facial não está configurado", 400);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true, faceRefKey: { not: null } }, select: { id: true, name: true, faceRefKey: true } }));
    if (!emps.length) throw new AppError(ErrorCode.NotFound, "Nenhum rosto cadastrado", 404);
    const candidates: { id: string; image: string }[] = [];
    for (const e of emps) { try { candidates.push({ id: e.id, image: (await this.storage.getPrivate(e.faceRefKey!)).body.toString("base64") }); } catch { /* skip */ } }
    const r = await this.face.identify(cfg as any, candidates, probeBuf);
    const emp = emps.find((e) => e.id === r.id);
    return { employeeId: r.id, employeeName: emp?.name ?? null, score: r.score, threshold: cfg.faceThreshold, wouldMatch: r.score != null && r.score >= cfg.faceThreshold, candidates: emps.length };
  }

  /** Serve a selfie (bucket privado) para o admin. */
  async selfie(ctx: RequestContext, punchId: string) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findFirst({ where: { id: punchId }, select: { photoUrl: true } }));
    if (!p?.photoUrl) throw new AppError(ErrorCode.NotFound, "Sem selfie", 404);
    return this.storage.getPrivate(p.photoUrl);
  }
}
