import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { createHash } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { JornadaService } from "./jornada.service";
import { PontoSignService } from "./sign.service";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Bônus de assiduidade. Regras (configuráveis): atestado até N dias no mês = ok;
 * medida disciplinar inelegibiliza; até N atrasos = ok; falta injustificada inelegibiliza.
 * Admissão no meio do mês ou retorno de férias → valor proporcional aos dias.
 */
@Injectable()
export class AssiduidadeService {
  constructor(private readonly prisma: PrismaService, private readonly jornada: JornadaService, private readonly sign: PontoSignService, private readonly storage: StorageService) {}

  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin }; }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private monthRange(ref: string) {
    const m = /^(\d{4})-(\d{2})/.exec(ref || ""); const now = new Date();
    const y = m ? Number(m[1]) : now.getUTCFullYear(); const mo = m ? Number(m[2]) : now.getUTCMonth() + 1;
    const first = new Date(Date.UTC(y, mo - 1, 1)); const last = new Date(Date.UTC(y, mo, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), first, monthDays: last.getUTCDate() };
  }
  private async cfg(ctx: RequestContext) {
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { assidBonusCents: true, assidMaxAtestadoDays: true, assidMaxLates: true, assidBlockMeasure: true, assidBlockFalta: true, assidProportional: true } })).catch(() => null);
    return {
      bonusCents: c?.assidBonusCents != null ? Number(c.assidBonusCents) : 15000,
      maxAtestado: c?.assidMaxAtestadoDays ?? 2, maxLates: c?.assidMaxLates ?? 4,
      blockMeasure: c?.assidBlockMeasure ?? true, blockFalta: c?.assidBlockFalta ?? true, proportional: c?.assidProportional ?? true,
    };
  }

  /** Calcula a assiduidade de um funcionário no mês (sem persistir). */
  private async computeOne(ctx: RequestContext, emp: { id: string; name: string; cpf: string | null; hrEmployeeId: string | null }, range: ReturnType<AssiduidadeService["monthRange"]>, cfg: Awaited<ReturnType<AssiduidadeService["cfg"]>>) {
    const esp: any = await this.jornada.espelho(ctx, { employeeId: emp.id, from: range.from, to: range.to }).catch(() => null);
    const days: any[] = esp?.days ?? [];
    // conta TODOS os atrasos por segmento (entrada, volta do almoço, etc.) — não notifica nada
    const lateCount = days.reduce((s, d) => s + (d.lateCount || 0), 0);
    const faltaDays = days.filter((d) => d.unjustifiedFalta || ((d.faltaMin || 0) > 0 && !d.justified && !d.abonado)).length;
    // dias com atestado: justificativa aprovada com anexo OU motivo "atestado"
    const fromD = new Date(`${range.from}T00:00:00Z`), toD = new Date(`${range.to}T23:59:59Z`);
    const just = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoJustification.findMany({ where: { employeeId: emp.id, status: "approved", day: { gte: fromD, lte: toD } }, select: { day: true, attachmentUrl: true, reason: true } })).catch(() => [] as any[]);
    const atestadoDays = new Set((just as any[]).filter((j) => j.attachmentUrl || /atestad/i.test(j.reason ?? "")).map((j) => new Date(j.day).toISOString().slice(0, 10))).size;
    // Medidas disciplinares aplicadas no mês. O módulo de medidas disciplinares
    // é do RH do RH e NÃO foi portado junto (está fora do ponto
    // eletrônico), então aqui o contador fica em zero: ninguém perde o bônus de
    // assiduidade por advertência enquanto esse módulo não existir no Vision.
    // Quando ele vier, basta trocar isto pela contagem real.
    const measures = 0;

    // dias trabalhados (admissão no meio do mês / férias no mês → proporcional)
    let startConsidered = range.first;
    let admissionInMonth = false;
    if (emp.hrEmployeeId) {
      const hr = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findFirst({ where: { id: emp.hrEmployeeId! }, select: { admissionDate: true } })).catch(() => null);
      if (hr?.admissionDate) { const a = new Date(hr.admissionDate); if (a > range.first && a <= toD) { startConsidered = a; admissionInMonth = true; } }
    }
    const vacs = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.findMany({ where: { employeeId: emp.id }, select: { startDate: true, days: true } })).catch(() => [] as any[]);
    let vacDays = 0;
    for (const v of vacs as any[]) { const vs = new Date(v.startDate); const ve = new Date(vs.getTime() + ((v.days || 0) - 1) * 86400000); const lo = vs > range.first ? vs : range.first; const hi = ve < toD ? ve : toD; if (hi >= lo && ve >= range.first && vs <= toD) vacDays += Math.floor((Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), hi.getUTCDate()) - Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate())) / 86400000) + 1; }
    const baseDays = Math.floor((Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), toD.getUTCDate()) - Date.UTC(startConsidered.getUTCFullYear(), startConsidered.getUTCMonth(), startConsidered.getUTCDate())) / 86400000) + 1;
    const daysWorked = Math.max(0, Math.min(range.monthDays, baseDays - vacDays));
    const proportional = cfg.proportional && (admissionInMonth || vacDays > 0);
    const amountCents = proportional ? Math.round(cfg.bonusCents * (daysWorked / range.monthDays)) : cfg.bonusCents;

    // elegibilidade
    const reasons: string[] = [];
    if (atestadoDays > cfg.maxAtestado) reasons.push(`${atestadoDays} dias de atestado (máx. ${cfg.maxAtestado})`);
    if (cfg.blockFalta && faltaDays > 0) reasons.push(`${faltaDays} falta(s) injustificada(s)`);
    if (cfg.blockMeasure && measures > 0) reasons.push(`${measures} medida(s) disciplinar(es)`);
    if (lateCount > cfg.maxLates) reasons.push(`${lateCount} atrasos (máx. ${cfg.maxLates})`);
    const eligible = reasons.length === 0;
    return { employeeId: emp.id, name: emp.name, cpf: emp.cpf, eligible, reason: eligible ? null : reasons.join("; "), atestadoDays, lateCount, faltaDays, measures, daysWorked, monthDays: range.monthDays, proportional, amountCents: eligible ? amountCents : 0 };
  }

  /** Ranking do mês: quem recebe e quem não (com motivo) + estado de liberação/assinatura. */
  async ranking(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const range = this.monthRange(refMonth); const cfg = await this.cfg(ctx);
    const closing = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.findFirst({ where: { refMonth: range.first as any }, select: { status: true } })).catch(() => null);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true, hrEmployeeId: true } }));
    const saved = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAssiduidade.findMany({ where: { refMonth: range.first as any } }));
    const sm = new Map(saved.map((s) => [s.pontoEmployeeId, s] as const));
    const items: any[] = [];
    for (const e of emps) {
      const r = await this.computeOne(ctx, e, range, cfg);
      const s = sm.get(e.id);
      items.push({ ...r, amountCents: r.eligible ? r.amountCents : 0, released: !!s?.released, signed: !!s?.signedAt, releasedAmountCents: s ? Number(s.amountCents) : null });
    }
    items.sort((a, b) => (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0) || b.amountCents - a.amountCents || a.name.localeCompare(b.name));
    const totalElig = items.filter((i) => i.eligible).length;
    const totalCents = items.filter((i) => i.eligible).reduce((s, i) => s + i.amountCents, 0);
    return { refMonth: range.first.toISOString().slice(0, 10), closed: closing?.status === "closed", bonusCents: cfg.bonusCents, totalEligible: totalElig, totalCents, items };
  }

  /** Disponibiliza no portal (snapshot dos elegíveis). Se employeeIds vier, só esses; senão todos os elegíveis. */
  async release(ctx: RequestContext, refMonth: string, employeeIds?: string[]) {
    this.requireAdmin(ctx);
    const rk = await this.ranking(ctx, refMonth);
    const range = this.monthRange(refMonth);
    const targets = rk.items.filter((i) => i.eligible && (!employeeIds?.length || employeeIds.includes(i.employeeId)));
    let n = 0;
    for (const i of targets) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAssiduidade.upsert({
        where: { organizationId_pontoEmployeeId_refMonth: { organizationId: ctx.orgId!, pontoEmployeeId: i.employeeId, refMonth: range.first } },
        update: { eligible: true, reason: null, amountCents: BigInt(i.amountCents), daysWorked: i.daysWorked, monthDays: i.monthDays, proportional: i.proportional, released: true, releasedAt: new Date(), updatedAt: new Date() },
        create: { organizationId: ctx.orgId!, pontoEmployeeId: i.employeeId, refMonth: range.first, eligible: true, amountCents: BigInt(i.amountCents), daysWorked: i.daysWorked, monthDays: i.monthDays, proportional: i.proportional, released: true, releasedAt: new Date() },
      }));
      n++;
    }
    return { ok: true, released: n };
  }

  // ---------------- PDF (3 recibos por folha A4) ----------------
  private async brand(ctx: RequestContext): Promise<{ name: string; color: string | null; logoBuf: Buffer | null; cnpj: string | null; city: string | null }> {
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, logoUrl: true, primaryColor: true } })).catch(() => null);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true, idtEmpregador: true, localPrestacao: true } })).catch(() => null);
    let logoBuf: Buffer | null = null;
    if (org?.logoUrl) { try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000); const res = await fetch(org.logoUrl, { signal: ctl.signal }); clearTimeout(t); if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); if ((b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8)) logoBuf = b; } } catch { /* ignore */ } }
    return { name: cfg?.razaoOuNome || org?.name || "Empresa", color: org?.primaryColor ?? null, logoBuf, cnpj: cfg?.idtEmpregador ? this.fmtCnpj(cfg.idtEmpregador) : null, city: cfg?.localPrestacao || null };
  }
  private fmtCnpj(d: string) { const s = (d || "").replace(/\D/g, ""); return s.length === 14 ? `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}` : d; }
  private monthName(first: Date) { return ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"][first.getUTCMonth()]; }

  /** Recibos em lote (PDF) dos elegíveis liberados — 3 por folha, com branding. */
  async batchPdf(ctx: RequestContext, refMonth: string): Promise<{ buffer: Buffer; filename: string; count: number }> {
    this.requireAdmin(ctx);
    const range = this.monthRange(refMonth);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAssiduidade.findMany({ where: { refMonth: range.first as any, eligible: true, released: true }, orderBy: { amountCents: "desc" } }));
    const empIds = rows.map((r) => r.pontoEmployeeId);
    const emps = empIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, cpf: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e] as const));
    const brand = await this.brand(ctx);
    const compMonth = `${this.monthName(range.first)} DE ${range.first.getUTCFullYear()}`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 28 }); const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      if (!rows.length) { pdf.font("Helvetica").fontSize(11).fillColor("#666").text("Nenhum recibo liberado neste mês.", 40, 60); pdf.end(); return; }
      const M = 28, W = pdf.page.width - M * 2; const blockH = (pdf.page.height - M * 2) / 3;
      rows.forEach((r, i) => {
        const slot = i % 3; if (i > 0 && slot === 0) pdf.addPage();
        const top = M + slot * blockH;
        this.drawReceipt(pdf, M, top, W, blockH - 10, brand, { name: nm.get(r.pontoEmployeeId)?.name ?? "—", cpf: nm.get(r.pontoEmployeeId)?.cpf ?? null, amountCents: Number(r.amountCents), compMonth, signedAt: r.signedAt, a1: r.a1Signed });
      });
      pdf.end();
    });
    return { buffer, filename: `recibos-assiduidade-${range.first.toISOString().slice(0, 7)}.pdf`, count: rows.length };
  }
  private drawReceipt(pdf: any, x: number, y: number, w: number, h: number, brand: { name: string; color: string | null; logoBuf: Buffer | null; cnpj: string | null; city: string | null }, r: { name: string; cpf: string | null; amountCents: number; compMonth: string; signedAt: Date | null; a1: boolean }) {
    const accent = brand.color && /^#[0-9a-fA-F]{6}$/.test(brand.color) ? brand.color : "#111827";
    pdf.save(); pdf.rect(x, y, w, h).lineWidth(1).strokeColor("#999").stroke();
    const pad = 14; let cy = y + 12;
    if (brand.logoBuf) { try { pdf.image(brand.logoBuf, x + pad, cy, { fit: [90, 26] }); } catch { /* ignore */ } }
    pdf.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("RECIBO", x + pad + (brand.logoBuf ? 100 : 0), cy, { width: w - pad * 2 - (brand.logoBuf ? 100 : 0) - 90, lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(12).fillColor(accent).text(`R$ ${(r.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, x + w - pad - 110, cy, { width: 110, align: "right" });
    cy += 22;
    const valor = `${brand.name}${brand.cnpj ? ` CNPJ ${brand.cnpj}` : ""}, a importância de ${this.extenso(r.amountCents)}.`;
    pdf.font("Helvetica").fontSize(8.5).fillColor("#222").text(valor, x + pad, cy, { width: w - pad * 2 });
    cy = pdf.y + 4;
    pdf.text(`REFERENTE BONIFICAÇÃO (ASSIDUIDADE) NO MÊS ${r.compMonth}`, x + pad, cy, { width: w - pad * 2 });
    cy = pdf.y + 8;
    pdf.text(`${brand.city ? brand.city + ", " : ""}______ de ____________ de ${new Date().getUTCFullYear()}.`, x + pad, cy, { width: w - pad * 2 });
    // assinatura
    const sy = y + h - 34; const cx = x + w / 2;
    pdf.moveTo(cx - 130, sy).lineTo(cx + 130, sy).strokeColor("#333").stroke();
    pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(r.name.toUpperCase(), x, sy + 3, { width: w, align: "center", lineBreak: false });
    if (r.cpf) pdf.font("Helvetica").fontSize(8).fillColor("#333").text(`CPF ${r.cpf}`, x, sy + 15, { width: w, align: "center", lineBreak: false });
    if (r.signedAt) pdf.font("Helvetica").fontSize(7).fillColor("#0a0").text(`Assinado digitalmente em ${new Date(r.signedAt).toLocaleString("pt-BR")}${r.a1 ? " · ICP-Brasil (A1)" : " · MP 2.200-2"}`, x + pad, sy + 24, { width: w - pad * 2, align: "center", lineBreak: false });
    pdf.restore();
  }
  /** Extenso simples de reais (até 999.999,99). */
  private extenso(cents: number): string {
    const reais = Math.floor(cents / 100); const c = cents % 100;
    const ext = (n: number): string => {
      if (n === 0) return "zero"; if (n === 100) return "cem";
      const u = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
      const d = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
      const ce = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
      const parts: string[] = []; let x = n;
      const mil = Math.floor(x / 1000); x %= 1000;
      if (mil) parts.push(mil === 1 ? "mil" : `${ext(mil)} mil`);
      const h = Math.floor(x / 100); x %= 100;
      if (h) parts.push(ce[h]!);
      if (x < 20) { if (x) parts.push(u[x]!); }
      else { const dd = Math.floor(x / 10), uu = x % 10; parts.push(uu ? `${d[dd]} e ${u[uu]}` : d[dd]!); }
      return parts.join(" e ").replace(/ e mil/, " mil");
    };
    const reaisTxt = `${ext(reais)} ${reais === 1 ? "real" : "reais"}`;
    const centTxt = c ? ` e ${ext(c)} ${c === 1 ? "centavo" : "centavos"}` : "";
    return `${reaisTxt}${centTxt}`;
  }

  // ---------------- Portal do funcionário ----------------
  async myReceipts(ctx: { organizationId: string; employeeId: string }) {
    const pe = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId: ctx.employeeId, organizationId: ctx.organizationId }, select: { id: true } })).catch(() => null);
    if (!pe) return [];
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoAssiduidade.findMany({ where: { pontoEmployeeId: pe.id, released: true }, orderBy: { refMonth: "desc" }, take: 24 }));
    return rows.map((r) => ({ refMonth: new Date(r.refMonth).toISOString().slice(0, 7), amountCents: Number(r.amountCents), signed: !!r.signedAt, signedAt: r.signedAt, a1: r.a1Signed }));
  }
  /** Funcionário assina o recibo (contingência ou A1). */
  async signReceipt(ctx: { organizationId: string; employeeId: string }, refMonth: string, signatureImageUrl?: string | null, ip?: string | null) {
    const range = this.monthRange(refMonth);
    const pe = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId: ctx.employeeId, organizationId: ctx.organizationId }, select: { id: true, employerId: true } })).catch(() => null);
    if (!pe) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);
    const row = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoAssiduidade.findFirst({ where: { organizationId: ctx.organizationId, pontoEmployeeId: pe.id, refMonth: range.first as any } }));
    if (!row || !row.released) throw new AppError(ErrorCode.Forbidden, "Recibo não disponível", 403);
    if (row.signedAt) return { ok: true, already: true };
    const hash = createHash("sha256").update(`${ctx.organizationId}|${pe.id}|${range.from}|${Number(row.amountCents)}`).digest("hex");
    let a1Signed = false, p7sKey: string | null = null;
    const p7s = await this.sign.sign(ctx.organizationId, Buffer.from(hash, "utf8"), pe.employerId ?? null).catch(() => null);
    if (p7s) { a1Signed = true; const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/assiduidade/${ctx.organizationId}`, contentType: "application/pkcs7-signature", body: p7s, originalName: `assiduidade-${range.from.slice(0, 7)}.p7s` }); p7sKey = key; }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoAssiduidade.update({ where: { id: row.id }, data: { contentHash: hash, signatureImageUrl: signatureImageUrl ?? null, signerIp: ip ?? null, a1Signed, p7sKey, signedAt: new Date() } }));
    return { ok: true, a1Signed };
  }
}
