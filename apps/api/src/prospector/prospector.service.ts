import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CrmService } from "../crm/crm.service";
import { normalizeWhatsappBR } from "../common/phone";
import type { RequestContext } from "../auth/session.middleware";

const ADM = { isPlatformAdmin: true as const };
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const BRASILAPI = process.env.BRASILAPI_URL || "https://brasilapi.com.br/api/cnpj/v1";
/** minúsculas + sem acento (casa com o município gravado pelo load-cnpj.sh). */
function unaccentLower(s?: string | null): string { return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
/** Empresa "viva" (não baixada/inapta). BrasilAPI: descricao_situacao_cadastral. */
function situacaoAtiva(s?: string | null): boolean {
  const v = (s ?? "").toUpperCase().trim();
  return v === "" || v === "ATIVA" || v === "02";
}

interface CampaignInput { name: string; source?: string; osmFilters?: Array<{ k: string; v: string }>; city?: string | null; state?: string | null; limitPerRun?: number; frequency?: string; autoCreateLead?: boolean; enrichCnpjAuto?: boolean; active?: boolean; }

/** Empresa normalizada vinda da BrasilAPI / cache cnpj_company. */
interface CnpjInfo { cnpj: string; razaoSocial: string | null; nomeFantasia: string | null; cnaePrincipal: string | null; uf: string | null; municipio: string | null; bairro: string | null; logradouro: string | null; numero: string | null; cep: string | null; telefone: string | null; email: string | null; situacao: string | null; }

@Injectable()
export class ProspectorService {
  private readonly logger = new Logger("Prospector");
  constructor(private readonly prisma: PrismaService, private readonly crm: CrmService) {}

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin }; }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403); }

  // ============================== CAMPANHAS ==============================
  async list(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
  }
  async create(ctx: RequestContext, input: CampaignInput): Promise<any> {
    this.requireOrg(ctx);
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome", 400);
    const source = input.source === "cnpj" ? "cnpj" : "osm";
    const filters = (input.osmFilters ?? []).filter((f) => f?.k && f?.v).slice(0, 10);
    if (!filters.length) throw new AppError(ErrorCode.ValidationFailed, source === "cnpj" ? "Informe ao menos um CNAE" : "Informe ao menos um filtro (ex.: shop=optician)", 400);
    if (!input.city?.trim()) throw new AppError(ErrorCode.ValidationFailed, source === "cnpj" ? "Informe o município" : "Informe a cidade", 400);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.create({
      data: { organizationId: ctx.orgId!, name: input.name.trim(), source, osmFilters: filters, city: input.city!.trim(), state: input.state?.trim() || null, limitPerRun: Math.min(200, Math.max(5, input.limitPerRun ?? 50)), frequency: input.frequency ?? "manual", autoCreateLead: input.autoCreateLead ?? true, enrichCnpjAuto: input.enrichCnpjAuto ?? false, active: input.active ?? true },
    }));
  }
  async update(ctx: RequestContext, id: string, input: Partial<CampaignInput>): Promise<any> {
    this.requireOrg(ctx);
    const data: any = {};
    for (const k of ["name", "city", "state", "frequency", "active", "autoCreateLead", "enrichCnpjAuto"] as const) if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    if (input.limitPerRun !== undefined) data.limitPerRun = Math.min(200, Math.max(5, input.limitPerRun));
    if (input.osmFilters !== undefined) data.osmFilters = input.osmFilters.filter((f) => f?.k && f?.v).slice(0, 10);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.update({ where: { id }, data }));
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.findFirst({ where: { id } }));
  }
  async remove(ctx: RequestContext, id: string): Promise<any> {
    this.requireOrg(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.deleteMany({ where: { id } }));
    return { ok: true };
  }
  async results(ctx: RequestContext, campaignId: string): Promise<any[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectResult.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 300 }));
  }

  /** Roda a campanha agora (chamado pela UI ou pelo scheduler). */
  async run(ctx: RequestContext, id: string): Promise<any> {
    this.requireOrg(ctx);
    const camp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectCampaign.findFirst({ where: { id } }));
    if (!camp) throw new AppError(ErrorCode.NotFound, "Campanha não encontrada", 404);
    const n = await this.runCampaign(camp);
    return { ok: true, found: n };
  }

  // ============================== EXECUÇÃO (OSM Overpass) ==============================
  /** Busca no OSM, deduplica, grava resultados e (opcional) cria leads. Best-effort. Retorna nº de novos. */
  async runCampaign(camp: any): Promise<number> {
    const orgId = camp.organizationId as string;
    const orgScope = { orgId } as any;
    let created = 0;
    try {
      const optouts = new Set((await this.prisma.runWithContext(orgScope, (tx) => tx.prospectOptout.findMany({ select: { value: true } })).catch(() => [])).map((o: any) => o.value));
      // normaliza cada candidato p/ {extRef, name, phone, website, address, raw}
      const candidates = camp.source === "cnpj"
        ? await this.queryCnpj(camp.osmFilters ?? [], camp.city, camp.state, camp.limitPerRun ?? 50)
        : await this.queryOsm(camp.osmFilters ?? [], camp.city, camp.state, camp.limitPerRun ?? 50);
      for (const c of candidates) {
        if (created >= (camp.limitPerRun ?? 50)) break;
        if (!c.name) continue;
        if (c.phone && optouts.has(c.phone)) continue;
        const dedupeKey = c.dedupeKey;
        const exists = await this.prisma.runWithContext(orgScope, (tx) => tx.prospectResult.findFirst({ where: { dedupeKey }, select: { id: true } })).catch(() => null);
        if (exists) continue;

        // Enriquecimento por CNPJ ao vivo (BrasilAPI), se ligado na campanha e
        // o candidato carregar um CNPJ. Preenche faltantes e detecta BAIXADA.
        let cnpj = this.extractCnpj(c);
        let info: CnpjInfo | null = null;
        let situacao: string | null = null;
        if (camp.enrichCnpjAuto && cnpj) {
          if (optouts.has(cnpj)) continue; // opt-out por CNPJ
          info = await this.lookupCnpjLive(cnpj).catch(() => null);
          await new Promise((res) => setTimeout(res, 300)); // gentil com a API pública
          if (info) {
            situacao = info.situacao;
            c.name = c.name || info.nomeFantasia || info.razaoSocial || c.name;
            if (!c.phone && info.telefone) c.phone = normalizeWhatsappBR(info.telefone);
            c.email = c.email || info.email || null;
            c.address = c.address || [info.logradouro, info.numero, info.bairro, info.municipio, info.uf].filter(Boolean).join(", ") || null;
            // empresa baixada/inapta → grava como descartado, não vira lead
            if (!situacaoAtiva(info.situacao)) {
              await this.prisma.runWithContext(orgScope, (tx) => tx.prospectResult.create({
                data: { organizationId: orgId, campaignId: camp.id, source: camp.source, externalRef: c.extRef ?? null, name: c.name, phone: c.phone ?? null, email: c.email ?? null, website: c.website ?? null, address: c.address ?? null, raw: { ...(c.raw ?? {}), cnpjInfo: info }, dedupeKey, status: "descartado", cnpj, situacao, enrichedAt: new Date() },
              })).catch(() => undefined);
              continue;
            }
          }
        }
        if (c.phone && optouts.has(c.phone)) continue; // re-checa após enriquecer telefone

        let leadId: string | null = null;
        if (camp.autoCreateLead) leadId = await this.crm.createSystemLead(orgId, { name: c.name, phone: c.phone ?? null, email: c.email ?? null, source: "prospector", scoreBoost: this.qualityBoost(c) }).catch(() => null);
        await this.prisma.runWithContext(orgScope, (tx) => tx.prospectResult.create({
          data: { organizationId: orgId, campaignId: camp.id, source: camp.source, externalRef: c.extRef ?? null, name: c.name, phone: c.phone ?? null, email: c.email ?? null, website: c.website ?? null, address: c.address ?? null, raw: info ? { ...(c.raw ?? {}), cnpjInfo: info } : (c.raw ?? undefined), dedupeKey, status: leadId ? "virou_lead" : "novo", leadId, cnpj: cnpj ?? null, situacao, enrichedAt: info ? new Date() : null },
        })).catch(() => undefined);
        created++;
      }
      await this.prisma.runWithContext(orgScope, (tx) => tx.prospectCampaign.update({ where: { id: camp.id }, data: { lastRunAt: new Date(), lastCount: created } })).catch(() => undefined);
      this.logger.log(`campanha ${camp.id} (${camp.source}/${camp.city}): ${created} novos`);
    } catch (e: any) {
      this.logger.warn(`runCampaign falhou (${camp.id}): ${e?.message}`);
      await this.prisma.runWithContext(orgScope, (tx) => tx.prospectCampaign.update({ where: { id: camp.id }, data: { lastRunAt: new Date(), lastCount: -1 } })).catch(() => undefined);
    }
    return created;
  }

  /** OSM → candidatos normalizados. */
  private async queryOsm(filters: Array<{ k: string; v: string }>, city?: string | null, state?: string | null, limit = 50): Promise<any[]> {
    const els = await this.queryOverpass(filters.filter((f) => f.k !== "cnae"), city, state, limit);
    return els.map((el: any) => {
      const t = el.tags ?? {};
      const phoneRaw = t["contact:phone"] || t.phone || t["phone:BR"] || null;
      const phone = phoneRaw ? normalizeWhatsappBR(phoneRaw) : null;
      return {
        extRef: `${el.type}/${el.id}`, name: (t.name || t["name:pt"] || "").trim(), phone,
        email: t["contact:email"] || t.email || null,
        website: t.website || t["contact:website"] || null,
        address: [t["addr:street"], t["addr:housenumber"], t["addr:suburb"], t["addr:city"]].filter(Boolean).join(", ") || null,
        raw: t, dedupeKey: phone || `osm:${el.type}/${el.id}`,
      };
    });
  }

  /** Base CNPJ (Receita) → candidatos por CNAE + município. */
  private async queryCnpj(filters: Array<{ k: string; v: string }>, city?: string | null, state?: string | null, limit = 50): Promise<any[]> {
    const cnaes = filters.filter((f) => f.k === "cnae").map((f) => f.v.replace(/\D/g, "")).filter(Boolean);
    if (!cnaes.length) return [];
    const mun = unaccentLower(city);
    const where: any = { situacao: { in: ["ATIVA", "02", "ativa", null] as any }, OR: cnaes.map((c) => ({ cnaePrincipal: { startsWith: c } })) };
    if (mun) where.municipio = { contains: mun };
    if (state) where.uf = state.trim().toUpperCase();
    const rows = await this.prisma.runWithContext(ADM, (tx) => tx.cnpjCompany.findMany({ where, take: Math.min(300, limit * 2), select: { cnpj: true, razaoSocial: true, nomeFantasia: true, telefone: true, email: true, logradouro: true, numero: true, bairro: true, municipio: true, uf: true } })).catch(() => [] as any[]);
    return rows.map((r: any) => {
      const phone = r.telefone ? normalizeWhatsappBR(r.telefone) : null;
      return {
        extRef: r.cnpj, name: (r.nomeFantasia || r.razaoSocial || "").trim(), phone, email: r.email || null, website: null,
        address: [r.logradouro, r.numero, r.bairro, r.municipio, r.uf].filter(Boolean).join(", ") || null,
        raw: { cnpj: r.cnpj }, dedupeKey: phone || `cnpj:${r.cnpj}`,
      };
    });
  }

  /** Importa base CNPJ (master). CSV: cnpj;razao;fantasia;cnae;uf;municipio;telefone;email;situacao */
  async importCnpj(ctx: RequestContext, csv: string): Promise<{ imported: number }> {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master importa a base CNPJ", 403);
    const lines = (csv || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let imported = 0;
    const rows: any[] = [];
    for (const line of lines) {
      const p = line.split(/[;,]/).map((s) => s.trim().replace(/^"|"$/g, ""));
      if (p.length < 4) continue;
      const cnpj = (p[0] ?? "").replace(/\D/g, "");
      if (cnpj.length < 8 || /^cnpj$/i.test(p[0] ?? "")) continue; // pula header
      rows.push({ cnpj, razaoSocial: p[1] || null, nomeFantasia: p[2] || null, cnaePrincipal: (p[3] ?? "").replace(/\D/g, "") || null, uf: (p[4] || "").toUpperCase() || null, municipio: unaccentLower(p[5]) || null, telefone: p[6] || null, email: p[7] || null, situacao: p[8] || "ATIVA" });
    }
    // upsert em lotes
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await this.prisma.runWithContext(ADM, (tx) => tx.cnpjCompany.createMany({ data: chunk, skipDuplicates: true })).catch(() => undefined);
      imported += chunk.length;
    }
    return { imported };
  }

  async cnpjCount(): Promise<number> {
    return this.prisma.runWithContext(ADM, (tx) => tx.cnpjCompany.count()).catch(() => 0);
  }

  // ============================== ENRIQUECIMENTO CNPJ (BrasilAPI) ==============================
  /** Tenta achar um CNPJ no candidato/resultado: externalRef (fonte cnpj) ou
   *  tags do OSM (ref:vatin "BR12345678000190", operator:cnpj, cnpj). */
  private extractCnpj(src: { extRef?: string | null; externalRef?: string | null; raw?: any; cnpj?: string | null }): string | null {
    const onlyDigits = (s?: string | null) => (s ?? "").replace(/\D/g, "");
    const cands: Array<string | null | undefined> = [src.cnpj, src.extRef, src.externalRef];
    const raw = src.raw ?? {};
    if (raw && typeof raw === "object") cands.push(raw.cnpj, raw["ref:vatin"], raw["operator:cnpj"], raw["ref:cnpj"]);
    for (const c of cands) { const d = onlyDigits(c); if (d.length === 14) return d; }
    return null;
  }

  /** Pontos de qualidade do lead: tem telefone/email/site. */
  private qualityBoost(c: { phone?: string | null; email?: string | null; website?: string | null }): number {
    return (c.phone ? 5 : 0) + (c.email ? 5 : 0) + (c.website ? 5 : 0);
  }

  /** Consulta um CNPJ na BrasilAPI (pública/grátis), normaliza e cacheia em
   *  cnpj_company. Retorna null se não encontrado / fora do ar. */
  async lookupCnpjLive(cnpj: string): Promise<CnpjInfo | null> {
    const d = (cnpj || "").replace(/\D/g, "");
    if (d.length !== 14) return null;
    // cache fresco (< 30 dias) evita bater na BrasilAPI de novo
    const cached = await this.prisma.runWithContext(ADM, (tx) => tx.cnpjCompany.findFirst({ where: { cnpj: d } })).catch(() => null);
    if (cached && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < 30 * 24 * 3600_000) {
      return { cnpj: d, razaoSocial: cached.razaoSocial, nomeFantasia: cached.nomeFantasia, cnaePrincipal: cached.cnaePrincipal, uf: cached.uf, municipio: cached.municipio, bairro: cached.bairro, logradouro: cached.logradouro, numero: cached.numero, cep: cached.cep, telefone: cached.telefone, email: cached.email, situacao: cached.situacao };
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    let j: any = null;
    try {
      const r = await fetch(`${BRASILAPI}/${d}`, { headers: { "User-Agent": "yugo-prospector/1.0", Accept: "application/json" }, signal: ctrl.signal });
      if (!r.ok) { if (r.status !== 404) this.logger.warn(`brasilapi HTTP ${r.status} (${d})`); return null; }
      j = await r.json().catch(() => null);
    } catch (e: any) { this.logger.warn(`brasilapi falhou (${d}): ${e?.message}`); return null; }
    finally { clearTimeout(to); }
    if (!j || typeof j !== "object") return null;
    const tel = j.ddd_telefone_1 ? String(j.ddd_telefone_1).replace(/\D/g, "") : null;
    const info: CnpjInfo = {
      cnpj: d,
      razaoSocial: j.razao_social ?? null,
      nomeFantasia: j.nome_fantasia || null,
      cnaePrincipal: j.cnae_fiscal != null ? String(j.cnae_fiscal) : null,
      uf: j.uf ?? null,
      municipio: j.municipio ?? null,
      bairro: j.bairro ?? null,
      logradouro: j.logradouro ?? null,
      numero: j.numero ?? null,
      cep: j.cep ? String(j.cep).replace(/\D/g, "") : null,
      telefone: tel,
      email: j.email || null,
      situacao: j.descricao_situacao_cadastral ?? null,
    };
    // cacheia (município em minúsculo sem acento, como a importação faz)
    await this.prisma.runWithContext(ADM, (tx) => tx.cnpjCompany.upsert({
      where: { cnpj: d },
      create: { cnpj: d, razaoSocial: info.razaoSocial, nomeFantasia: info.nomeFantasia, cnaePrincipal: info.cnaePrincipal, uf: info.uf, municipio: unaccentLower(info.municipio), bairro: info.bairro, logradouro: info.logradouro, numero: info.numero, cep: info.cep, telefone: info.telefone, email: info.email, situacao: info.situacao },
      update: { razaoSocial: info.razaoSocial, nomeFantasia: info.nomeFantasia, cnaePrincipal: info.cnaePrincipal, uf: info.uf, municipio: unaccentLower(info.municipio), bairro: info.bairro, logradouro: info.logradouro, numero: info.numero, cep: info.cep, telefone: info.telefone, email: info.email, situacao: info.situacao, updatedAt: new Date() },
    })).catch(() => undefined);
    return info;
  }

  /** Enriquece um resultado existente: acha o CNPJ, consulta a BrasilAPI,
   *  preenche faltantes, marca situação. BAIXADA → status descartado. */
  async enrichResult(ctx: RequestContext, id: string): Promise<any> {
    this.requireOrg(ctx);
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectResult.findFirst({ where: { id } }));
    if (!r) throw new AppError(ErrorCode.NotFound, "Resultado não encontrado", 404);
    const cnpj = this.extractCnpj({ cnpj: (r as any).cnpj, externalRef: r.externalRef, raw: r.raw });
    if (!cnpj) throw new AppError(ErrorCode.ValidationFailed, "Este resultado não tem CNPJ pra consultar", 400);
    const info = await this.lookupCnpjLive(cnpj);
    if (!info) throw new AppError(ErrorCode.NotFound, "CNPJ não encontrado na BrasilAPI", 404);
    const ativa = situacaoAtiva(info.situacao);
    const phone = r.phone || (info.telefone ? normalizeWhatsappBR(info.telefone) : null);
    const address = r.address || [info.logradouro, info.numero, info.bairro, info.municipio, info.uf].filter(Boolean).join(", ") || null;
    const name = r.name || info.nomeFantasia || info.razaoSocial || "Empresa";
    const updated = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectResult.update({
      where: { id },
      data: { cnpj, situacao: info.situacao, enrichedAt: new Date(), name, phone, email: r.email || info.email || null, address, raw: { ...(r.raw as any), cnpjInfo: info }, status: ativa ? r.status : "descartado" },
    }));
    // propaga pro lead vinculado (só preenche faltantes)
    if (r.leadId && ativa) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.crmLead.updateMany({
        where: { id: r.leadId!, OR: [{ phone: null }, { email: null }] },
        data: { ...(phone ? { phone } : {}), ...((r.email || info.email) ? { email: r.email || info.email } : {}) },
      })).catch(() => undefined);
    }
    return updated;
  }

  /** Consulta ad-hoc de um CNPJ (operador com o CNPJ em mãos). Opcionalmente
   *  cria um lead já na fila. */
  async lookupCnpj(ctx: RequestContext, cnpj: string, createLead = false): Promise<any> {
    this.requireOrg(ctx);
    const info = await this.lookupCnpjLive(cnpj);
    if (!info) throw new AppError(ErrorCode.NotFound, "CNPJ não encontrado na BrasilAPI", 404);
    const ativa = situacaoAtiva(info.situacao);
    let leadId: string | null = null;
    if (createLead && ativa) {
      const phone = info.telefone ? normalizeWhatsappBR(info.telefone) : null;
      leadId = await this.crm.createSystemLead(ctx.orgId!, { name: info.nomeFantasia || info.razaoSocial || "Empresa", phone, email: info.email, source: "prospector", scoreBoost: this.qualityBoost({ phone, email: info.email, website: null }) }).catch(() => null);
    }
    return { company: info, active: ativa, leadId };
  }

  private async queryOverpass(filters: Array<{ k: string; v: string }>, city?: string | null, state?: string | null, limit = 50): Promise<any[]> {
    const esc = (s: string) => String(s).replace(/"/g, '\\"');
    const areaName = esc(city || state || "");
    if (!areaName) return [];
    const sel = filters.map((f) => `node(area.a)["${esc(f.k)}"="${esc(f.v)}"];way(area.a)["${esc(f.k)}"="${esc(f.v)}"];`).join("");
    const q = `[out:json][timeout:25];area["name"="${areaName}"]["boundary"="administrative"]->.a;(${sel});out center tags ${Math.min(300, limit * 2)};`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(OVERPASS, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "yugo-prospector/1.0" }, body: `data=${encodeURIComponent(q)}`, signal: ctrl.signal });
      if (!r.ok) { this.logger.warn(`overpass HTTP ${r.status}`); return []; }
      const j: any = await r.json().catch(() => null);
      return Array.isArray(j?.elements) ? j.elements : [];
    } finally { clearTimeout(to); }
  }

  // ============================== OPT-OUT (LGPD) ==============================
  async listOptout(ctx: RequestContext): Promise<any[]> { this.requireOrg(ctx); return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectOptout.findMany({ orderBy: { createdAt: "desc" }, take: 500 })); }
  async addOptout(ctx: RequestContext, value: string, kind = "phone"): Promise<any> {
    this.requireOrg(ctx);
    const v = kind === "phone" ? normalizeWhatsappBR(value) : value.replace(/\D/g, "");
    if (!v) throw new AppError(ErrorCode.ValidationFailed, "Valor inválido", 400);
    const ex = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectOptout.findFirst({ where: { value: v }, select: { id: true } })).catch(() => null);
    if (ex) return ex;
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.prospectOptout.create({ data: { organizationId: ctx.orgId!, kind, value: v } }));
  }

  // ============================== SCHEDULER ==============================
  /** Roda campanhas ativas vencidas conforme a frequência (chamado pelo scheduler). */
  async runDue(): Promise<void> {
    const now = Date.now();
    const camps = await this.prisma.runWithContext(ADM, (tx) => tx.prospectCampaign.findMany({ where: { active: true, frequency: { in: ["daily", "weekly"] } }, take: 200 })).catch(() => [] as any[]);
    for (const c of camps) {
      const everyMs = c.frequency === "daily" ? 24 * 3600_000 : 7 * 24 * 3600_000;
      const due = !c.lastRunAt || now - new Date(c.lastRunAt).getTime() >= everyMs;
      if (!due) continue;
      await this.runCampaign(c).catch(() => undefined);
      await new Promise((res) => setTimeout(res, 3000)); // gentil com a API pública
    }
  }
}
