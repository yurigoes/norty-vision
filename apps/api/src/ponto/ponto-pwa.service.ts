import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PontoService } from "./ponto.service";
import { FaceService } from "./face.service";
import { loadEnv } from "../config";
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
  // cripto de credenciais (RustDesk) — AES-256-GCM com chave derivada do COOKIE_SECRET
  private aesKey(): Buffer { return createHash("sha256").update(`${loadEnv().COOKIE_SECRET}:ponto-terminal`).digest(); }
  private enc(plain: string): string {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", this.aesKey(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); const tag = c.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }
  private dec(enc: string): string {
    try { const [iv, tag, ct] = enc.split(":"); const d = createDecipheriv("aes-256-gcm", this.aesKey(), Buffer.from(iv!, "base64")); d.setAuthTag(Buffer.from(tag!, "base64")); return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8"); } catch { return ""; }
  }
  private online(lastSeenAt: Date | null): boolean { return !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 6 * 60_000; }

  /** Gera um código único do terminal (ex.: CENTRO-T03) com base na loja. */
  private async nextCode(ctx: RequestContext, storeId?: string | null): Promise<string> {
    let prefix = "T";
    if (storeId) { const s = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findFirst({ where: { id: storeId }, select: { slug: true, name: true } })).catch(() => null); const base = (s?.slug || s?.name || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "").slice(0, 8); if (base) prefix = base; }
    const existing = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.findMany({ where: {}, select: { code: true } }));
    const used = new Set(existing.map((e) => e.code).filter(Boolean) as string[]);
    for (let i = 1; i <= 99; i++) { const c = `${prefix}-T${String(i).padStart(2, "0")}`; if (!used.has(c)) return c; }
    return `${prefix}-T${randomBytes(2).toString("hex").toUpperCase()}`;
  }

  // ----- ADMIN: dispositivos / terminais (REP) -----
  async listDevices(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.findMany({ where: {}, orderBy: [{ code: "asc" }, { createdAt: "desc" }] }));
    return rows.map((d) => ({ id: d.id, code: d.code, name: d.name, storeId: d.storeId, employerId: d.employerId, rustdeskId: d.rustdeskId, hasRustdeskPass: !!d.rustdeskPassEnc, appVersion: d.appVersion, notes: d.notes, geoLat: d.geoLat, geoLng: d.geoLng, geoRadiusM: d.geoRadiusM, requireGeo: d.requireGeo, requireSelfie: d.requireSelfie, lastSeenAt: d.lastSeenAt, online: this.online(d.lastSeenAt), revoked: !!d.revokedAt }));
  }
  async createDevice(ctx: RequestContext, input: { name: string; code?: string; storeId?: string; employerId?: string; rustdeskId?: string; rustdeskPass?: string; notes?: string; geoLat?: number; geoLng?: number; geoRadiusM?: number; requireGeo?: boolean; requireSelfie?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Nome obrigatório", 400);
    const code = (input.code?.trim() || (await this.nextCode(ctx, input.storeId))).slice(0, 40);
    const token = randomBytes(24).toString("base64url");
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.create({
      data: {
        organizationId: orgId, name: input.name.trim(), code, storeId: input.storeId || null, employerId: input.employerId || null,
        rustdeskId: input.rustdeskId?.trim() || null, rustdeskPassEnc: input.rustdeskPass ? this.enc(input.rustdeskPass) : null, notes: input.notes?.slice(0, 500) || null,
        tokenHash: this.hash(token),
        geoLat: input.geoLat ?? null, geoLng: input.geoLng ?? null, geoRadiusM: Math.max(20, Math.min(5000, input.geoRadiusM ?? 150)),
        requireGeo: !!input.requireGeo, requireSelfie: !!input.requireSelfie,
      },
    }));
    return { id: row.id, code, token }; // token cru só aqui
  }
  async updateDevice(ctx: RequestContext, id: string, input: { name?: string; code?: string; storeId?: string | null; employerId?: string | null; rustdeskId?: string | null; rustdeskPass?: string | null; notes?: string | null; geoLat?: number; geoLng?: number; geoRadiusM?: number; requireGeo?: boolean; requireSelfie?: boolean; revoked?: boolean }) {
    this.requireAdmin(ctx);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.code !== undefined) data.code = input.code?.trim()?.slice(0, 40) || null;
    if (input.storeId !== undefined) data.storeId = input.storeId || null;
    if (input.employerId !== undefined) data.employerId = input.employerId || null;
    if (input.rustdeskId !== undefined) data.rustdeskId = input.rustdeskId?.trim() || null;
    if (input.rustdeskPass !== undefined) data.rustdeskPassEnc = input.rustdeskPass ? this.enc(input.rustdeskPass) : null;
    if (input.notes !== undefined) data.notes = input.notes?.slice(0, 500) || null;
    if (input.geoLat !== undefined) data.geoLat = input.geoLat;
    if (input.geoLng !== undefined) data.geoLng = input.geoLng;
    if (input.geoRadiusM !== undefined) data.geoRadiusM = Math.max(20, Math.min(5000, input.geoRadiusM));
    if (input.requireGeo !== undefined) data.requireGeo = !!input.requireGeo;
    if (input.requireSelfie !== undefined) data.requireSelfie = !!input.requireSelfie;
    if (input.revoked !== undefined) data.revokedAt = input.revoked ? new Date() : null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.update({ where: { id }, data }));
    return { ok: true };
  }
  /** Revela o acesso RustDesk (id + senha) para o admin conectar. */
  async deviceRustdesk(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    const d = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.findFirst({ where: { id }, select: { rustdeskId: true, rustdeskPassEnc: true } }));
    if (!d) throw new AppError(ErrorCode.NotFound, "Terminal não encontrado", 404);
    return { rustdeskId: d.rustdeskId ?? null, password: d.rustdeskPassEnc ? this.dec(d.rustdeskPassEnc) : null };
  }

  /** Lista as lojas (stores) ativas da empresa — usada nos selects de loja (terminais, escalas, RH). */
  async listStores(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findMany({ where: { status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ).catch(() => [] as any[]);
  }

  /** Lista TODAS as lojas (inclui inativas) com detalhes — para a tela de gestão de lojas. */
  async listStoresAdmin(ctx: RequestContext) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findMany({ where: {}, select: { id: true, name: true, slug: true, city: true, state: true, status: true }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    ).catch(() => [] as any[]);
  }

  private slugify(s: string): string {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "loja";
  }
  /** Gera um slug único dentro da org (loja, loja-2, loja-3…). */
  private async uniqueStoreSlug(ctx: RequestContext, base: string, ignoreId?: string): Promise<string> {
    const root = this.slugify(base);
    const taken = new Set((await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findMany({ where: ignoreId ? { id: { not: ignoreId } } : {}, select: { slug: true } })).catch(() => [] as any[])).map((r: any) => r.slug));
    if (!taken.has(root)) return root;
    for (let i = 2; i < 999; i++) { const c = `${root}-${i}`.slice(0, 40); if (!taken.has(c)) return c; }
    return `${root}-${randomBytes(2).toString("hex")}`;
  }

  /** Cria uma nova loja (filial) da empresa. */
  async createStore(ctx: RequestContext, input: { name?: string; slug?: string; city?: string | null; state?: string | null }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const name = (input.name || "").trim();
    if (name.length < 2) throw new AppError(ErrorCode.ValidationFailed, "Nome da loja obrigatório", 400);
    const slug = await this.uniqueStoreSlug(ctx, input.slug?.trim() || name);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.create({
      data: { organizationId: orgId, slug, name, city: input.city?.trim() || null, state: input.state?.trim()?.toUpperCase()?.slice(0, 2) || null, status: "active" },
      select: { id: true, name: true, slug: true },
    }));
    return row;
  }

  /** Edita uma loja (nome, cidade/UF, ativa/inativa). */
  async updateStore(ctx: RequestContext, id: string, input: { name?: string; city?: string | null; state?: string | null; status?: string }) {
    this.requireAdmin(ctx);
    const data: any = {};
    if (input.name !== undefined) { const n = input.name.trim(); if (n.length < 2) throw new AppError(ErrorCode.ValidationFailed, "Nome inválido", 400); data.name = n; }
    if (input.city !== undefined) data.city = input.city?.trim() || null;
    if (input.state !== undefined) data.state = input.state?.trim()?.toUpperCase()?.slice(0, 2) || null;
    if (input.status !== undefined) data.status = input.status === "inactive" ? "inactive" : "active";
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.update({ where: { id }, data }));
    return { ok: true };
  }

  /** Relatório (PDF) dos terminais para fiscalização: código, loja, CNPJ, RustDesk, status, nº de batidas. */
  async terminalsReportPdf(ctx: RequestContext): Promise<{ buffer: Buffer; filename: string }> {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoDevice.findMany({ where: {}, orderBy: [{ code: "asc" }] }));
    const stores = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findMany({ where: {}, select: { id: true, name: true } }));
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.findMany({ where: {}, select: { id: true, name: true, idtEmpregador: true } })).catch(() => [] as any[]);
    const counts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.groupBy({ by: ["deviceId"], _count: { _all: true } })).catch(() => [] as any[]);
    const sm = new Map(stores.map((s) => [s.id, s.name] as const));
    const em = new Map((emps as any[]).map((e) => [e.id, `${e.name}${e.idtEmpregador ? ` (${e.idtEmpregador})` : ""}`] as const));
    const cm = new Map((counts as any[]).map((c) => [c.deviceId, c._count._all] as const));
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true } })).catch(() => null);
    // quem pode bater em cada terminal: funcionários restritos (whitelist) + os sem restrição + alocados
    const empList = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, select: { name: true, allowedDeviceIds: true } })).catch(() => [] as any[]);
    const restricted = (empList as any[]).map((e) => ({ name: e.name, ids: Array.isArray(e.allowedDeviceIds) ? (e.allowedDeviceIds as any[]).map(String) : [] })).filter((e) => e.ids.length > 0);
    const unrestrictedCount = (empList as any[]).length - restricted.length;
    const allocCount = (await this.activeAllocationsTo(ctx.orgId!)).length;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 }); const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      pdf.font("Helvetica-Bold").fontSize(15).text(cfg?.razaoOuNome || "Empresa", { align: "center" });
      pdf.fontSize(12).text("Relação de Terminais de Ponto (REP-P)", { align: "center" });
      pdf.font("Helvetica").fontSize(8).fillColor("#666").text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
      pdf.moveDown(0.6); pdf.fillColor("#111");
      for (const d of rows) {
        if (pdf.y > pdf.page.height - 110) pdf.addPage();
        pdf.font("Helvetica-Bold").fontSize(10).text(`${d.code ?? "—"} · ${d.name}`);
        pdf.font("Helvetica").fontSize(9).fillColor("#333");
        pdf.text(`Loja: ${d.storeId ? (sm.get(d.storeId) ?? "—") : "—"}   ·   Empregador (CNPJ): ${d.employerId ? (em.get(d.employerId) ?? "—") : "—"}`);
        pdf.text(`RustDesk: ${d.rustdeskId ?? "—"}   ·   Status: ${d.revokedAt ? "revogado" : this.online(d.lastSeenAt) ? "online" : "offline"}   ·   Última atividade: ${d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("pt-BR") : "—"}`);
        pdf.text(`Batidas registradas: ${cm.get(d.id) ?? 0}   ·   App: ${d.appVersion ?? "—"}${d.notes ? `   ·   ${d.notes}` : ""}`);
        // quem pode bater neste terminal
        const liberados = restricted.filter((e) => e.ids.includes(d.id)).map((e) => e.name);
        const extras: string[] = [];
        if (unrestrictedCount > 0) extras.push(`+${unrestrictedCount} sem restrição (qualquer terminal)`);
        if (allocCount > 0) extras.push(`+${allocCount} alocado(s)`);
        const quem = [liberados.length ? liberados.join(", ") : null, extras.length ? extras.join(" · ") : null].filter(Boolean).join(" · ") || "ninguém liberado";
        pdf.fillColor("#555").fontSize(8).text(`Quem pode bater: ${quem}`); pdf.fontSize(9);
        pdf.fillColor("#111").moveDown(0.5); pdf.moveTo(40, pdf.y).lineTo(pdf.page.width - 40, pdf.y).strokeColor("#eee").stroke(); pdf.moveDown(0.4);
      }
      pdf.end();
    });
    return { buffer, filename: `terminais-rep-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  // ----- PÚBLICO (token do dispositivo) -----
  private async device(token: string, ip: string | null) {
    if (!token) throw new AppError(ErrorCode.Unauthorized, "Token ausente", 401);
    const d = await this.prisma.runWithContext({ isPlatformAdmin: true },(tx) => tx.pontoDevice.findFirst({ where: { tokenHash: this.hash(token) } }));
    if (!d || d.revokedAt) throw new AppError(ErrorCode.Unauthorized, "Dispositivo inválido ou revogado", 401);
    await this.prisma.runWithContext({ isPlatformAdmin: true },(tx) => tx.pontoDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastSeenIp: ip } }));
    return d;
  }

  /** Últimas batidas de UM terminal (admin) — NUNCA exposto ao kiosk. */
  async terminalPunches(ctx: RequestContext, deviceId: string) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findMany({ where: { deviceId }, orderBy: { punchedAt: "desc" }, take: 20, select: { id: true, employeeId: true, punchedAt: true, voided: true } }));
    const ids = [...new Set(rows.map((r) => r.employeeId))];
    const emps = ids.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name] as const));
    return { items: rows.map((r) => ({ id: r.id, name: nm.get(r.employeeId) ?? "—", at: r.punchedAt, voided: r.voided })) };
  }

  async bootstrap(token: string, ip: string | null, appVersion?: string | null) {
    const d = await this.device(token, ip);
    const orgId = d.organizationId;
    if (appVersion && appVersion !== d.appVersion) await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoDevice.update({ where: { id: d.id }, data: { appVersion: appVersion.slice(0, 40) } })).catch(() => undefined);
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
    }, ip, { device: d.name, deviceId: d.id });
    const notices = await this.ponto.activeNotices(orgId, emp.id);
    return { ...res, employeeName: emp.name, faceScore: r.score, notices };
  }

  /** Alocações ATIVAS e vigentes destinadas a esta empresa (tomadora) — contexto interno. */
  private async activeAllocationsTo(borrowerOrgId: string): Promise<Array<{ pontoEmployeeId: string; ownerOrgId: string; posto: string | null }>> {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoAllocation.findMany({
      where: { borrowerOrgId, status: "active", startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
      select: { pontoEmployeeId: true, ownerOrgId: true, posto: true },
    })).catch(() => [] as any[]);
    return rows as any[];
  }
  /** Resolve a empregadora (dono) de um funcionário alocado nesta empresa, se houver. */
  private async resolveAllocationFor(borrowerOrgId: string, pontoEmployeeId: string): Promise<{ ownerOrgId: string; posto: string | null } | null> {
    const a = (await this.activeAllocationsTo(borrowerOrgId)).find((x) => x.pontoEmployeeId === pontoEmployeeId);
    return a ? { ownerOrgId: a.ownerOrgId, posto: a.posto } : null;
  }

  /** Identifica o funcionário por código de barras / CPF / matrícula (sem expor a lista). */
  async identify(token: string, identifier: string, ip: string | null) {
    const d = await this.device(token, ip);
    // 1) funcionário da própria empresa do terminal
    const own = await this.ponto.resolveIdentifier(d.organizationId, identifier);
    if (own) return own; // { id, name, requiresPin }
    // 2) funcionário ALOCADO nesta empresa (cedido por outra) — só os autorizados
    const allocs = await this.activeAllocationsTo(d.organizationId);
    const allowed = new Set(allocs.map((a) => a.pontoEmployeeId));
    for (const oid of [...new Set(allocs.map((a) => a.ownerOrgId))]) {
      const e = await this.ponto.resolveIdentifier(oid, identifier);
      if (e && allowed.has(e.id)) return { ...e, allocated: true };
    }
    throw new AppError(ErrorCode.NotFound, "Não encontrei esse funcionário. Confira o código, CPF ou matrícula.", 404);
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
    // DESTINO da batida: por padrão a empresa do terminal; se o funcionário é
    // ALOCADO aqui (cedido por outra empresa), a batida é gravada na EMPREGADORA
    // (dono), na cadeia NSR/hash dela — o terminal de B é só o ponto de captura.
    let targetOrgId = orgId; let allocated = false;
    const inOrg = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findFirst({ where: { id: body.employeeId }, select: { id: true, allowedDeviceIds: true } }));
    if (!inOrg) {
      const alloc = await this.resolveAllocationFor(orgId, body.employeeId);
      if (!alloc) throw new AppError(ErrorCode.Forbidden, "Funcionário não autorizado neste terminal", 403);
      targetOrgId = alloc.ownerOrgId; allocated = true; flags.push("alocado");
    } else {
      // whitelist de terminais por funcionário (só p/ terminais da própria empresa).
      // [] = sem restrição; com IDs = só pode bater nos terminais liberados.
      const allowed = Array.isArray(inOrg.allowedDeviceIds) ? (inOrg.allowedDeviceIds as any[]).map(String) : [];
      if (allowed.length > 0 && !allowed.includes(d.id)) throw new AppError(ErrorCode.Forbidden, "Este terminal não está liberado para você. Procure o RH.", 403);
    }
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
      const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/selfies/${targetOrgId}`, contentType: m[1]!, body: probeBuf });
      photoUrl = key; // bucket privado: guardamos a key, servida via endpoint autenticado
    }
    // Reconhecimento facial — só para funcionário da própria empresa do terminal.
    // Para ALOCADOS, o rosto cadastrado vive na empregadora (outro tenant) e o provedor
    // facial pode diferir; capturamos a selfie (auditoria) mas não fazemos o match cruzado.
    let faceScore: number | null = null, faceMatch: boolean | null = null;
    if (cfg?.requireFace && probeBuf && !allocated) {
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
    const res = await this.ponto.punchCore(targetOrgId, {
      employeeId: body.employeeId, pin: body.pin, origin: "pwa",
      lat: body.lat, lng: body.lng, accuracy: body.accuracy, photoUrl,
      offline: body.offline, deviceAt: body.deviceAt,
      faceScore, faceMatch, livenessOk, fraudFlags: flags,
    }, ip, { device: d.name, deviceId: d.id });
    const notices = await this.ponto.activeNotices(targetOrgId, body.employeeId);
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
