import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Alocação / cessão de mão de obra cross-tenant.
 * - Owner (empresa A) = empregadora legal; gerencia as alocações (CRUD).
 * - Borrower (empresa B) = tomadora; vê (somente leitura) os alocados e suas batidas.
 * Acesso cruzado é mediado pela RLS de ponto_allocation; dados do funcionário/owner
 * são lidos em contexto interno (platform-admin) apenas para os IDs já autorizados.
 */
@Injectable()
export class AllocationService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private day(s?: string | null): Date | null { if (!s) return null; const d = new Date(`${s}T00:00:00Z`); return isNaN(d.getTime()) ? null : d; }

  /** Funcionários (ponto) ativos do owner — para o seletor de alocação. */
  async ownEmployees(ctx: RequestContext) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, select: { id: true, name: true, cargo: true }, orderBy: { name: "asc" } }));
  }

  /** Resolve a empresa tomadora pelo slug (outro tenant), validando que existe/ativa e não é a própria. */
  private async resolveBorrower(ctx: RequestContext, slug: string): Promise<{ id: string; name: string }> {
    const s = (slug || "").trim().toLowerCase();
    if (!s) throw new AppError(ErrorCode.ValidationFailed, "Informe o identificador (slug) da empresa tomadora", 400);
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { slug: s }, select: { id: true, name: true, status: true } }));
    if (!org || org.status === "inactive") throw new AppError(ErrorCode.NotFound, "Empresa tomadora não encontrada", 404);
    if (org.id === ctx.orgId) throw new AppError(ErrorCode.ValidationFailed, "A tomadora não pode ser a própria empresa", 400);
    return { id: org.id, name: org.name };
  }

  private async orgNames(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } }));
    return new Map(rows.map((r) => [r.id, r.name] as const));
  }
  private async empNames(ids: string[]): Promise<Map<string, { name: string; cargo: string | null }>> {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoEmployee.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, cargo: true } }));
    return new Map(rows.map((r) => [r.id, { name: r.name, cargo: r.cargo ?? null }] as const));
  }

  /** Cria uma alocação (owner cede funcionário para a tomadora pelo slug). */
  async create(ctx: RequestContext, input: { pontoEmployeeId?: string; borrowerSlug?: string; posto?: string; startsAt?: string; endsAt?: string; reason?: string; billRateCents?: number }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const empId = (input.pontoEmployeeId || "").trim();
    if (!empId) throw new AppError(ErrorCode.ValidationFailed, "Selecione o funcionário", 400);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: empId }, select: { id: true } }));
    if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado nesta empresa", 404);
    const borrower = await this.resolveBorrower(ctx, input.borrowerSlug || "");
    const startsAt = this.day(input.startsAt) ?? this.day(new Date().toISOString().slice(0, 10))!;
    const endsAt = this.day(input.endsAt);
    if (endsAt && endsAt < startsAt) throw new AppError(ErrorCode.ValidationFailed, "Data final antes da inicial", 400);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.create({
      data: {
        ownerOrgId: orgId, borrowerOrgId: borrower.id, pontoEmployeeId: empId,
        posto: input.posto?.trim() || null, startsAt, endsAt, status: "active",
        billRateCents: input.billRateCents != null ? BigInt(Math.max(0, Math.round(input.billRateCents))) : null,
        reason: input.reason?.slice(0, 500) || null, authorizedByUserId: ctx.userId ?? null,
      },
      select: { id: true },
    }));
    return { id: row.id, borrowerName: borrower.name };
  }

  /** Encerra/cancela uma alocação (owner). */
  async end(ctx: RequestContext, id: string, status: "ended" | "cancelled" = "ended") {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.updateMany({ where: { id, ownerOrgId: ctx.orgId! }, data: { status, endsAt: this.day(new Date().toISOString().slice(0, 10)), updatedAt: new Date() } }));
    return { ok: true };
  }

  /** Lista as alocações CEDIDAS por nós (owner). */
  async listOwned(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.findMany({ where: { ownerOrgId: ctx.orgId! }, orderBy: [{ status: "asc" }, { startsAt: "desc" }] }));
    const empMap = await this.empNames(rows.map((r) => r.pontoEmployeeId));
    const orgMap = await this.orgNames(rows.map((r) => r.borrowerOrgId));
    return rows.map((r) => ({
      id: r.id, status: r.status, posto: r.posto, startsAt: r.startsAt, endsAt: r.endsAt, reason: r.reason,
      billRateCents: r.billRateCents != null ? Number(r.billRateCents) : null,
      employeeId: r.pontoEmployeeId, employeeName: empMap.get(r.pontoEmployeeId)?.name ?? "—", cargo: empMap.get(r.pontoEmployeeId)?.cargo ?? null,
      borrowerOrgId: r.borrowerOrgId, borrowerName: orgMap.get(r.borrowerOrgId) ?? "—",
    }));
  }

  /** Lista os funcionários ALOCADOS AQUI (borrower) — somente leitura, via RLS. */
  async listBorrowed(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.findMany({ where: { borrowerOrgId: ctx.orgId! }, orderBy: { startsAt: "desc" } }));
    const empMap = await this.empNames(rows.map((r) => r.pontoEmployeeId));
    const orgMap = await this.orgNames(rows.map((r) => r.ownerOrgId));
    return rows.map((r) => ({
      id: r.id, posto: r.posto, startsAt: r.startsAt, endsAt: r.endsAt,
      employeeName: empMap.get(r.pontoEmployeeId)?.name ?? "—", cargo: empMap.get(r.pontoEmployeeId)?.cargo ?? null,
      employerName: orgMap.get(r.ownerOrgId) ?? "—",
    }));
  }

  /** Minutos trabalhados (pares entrada/saída) de um funcionário numa janela — contexto interno. */
  private async workedMin(employeeId: string, lo: Date, hi: Date): Promise<{ count: number; workedMin: number }> {
    const punches = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoPunch.findMany({ where: { employeeId, voided: false, punchedAt: { gte: lo, lte: hi } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }));
    let workedMin = 0;
    for (let i = 0; i + 1 < punches.length; i += 2) workedMin += Math.max(0, Math.round((new Date(punches[i + 1]!.punchedAt).getTime() - new Date(punches[i]!.punchedAt).getTime()) / 60000));
    return { count: punches.length, workedMin };
  }
  /** Interseção [from,to] ∩ [startsAt,endsAt] de uma alocação. */
  private window(a: { startsAt: Date; endsAt: Date | null }, from?: string, to?: string): { lo: Date; hi: Date } {
    const fFrom = this.day(from)?.getTime() ?? 0;
    const fTo = (this.day(to) ?? new Date()).getTime() + 86399000;
    const lo = new Date(Math.max(fFrom, new Date(a.startsAt).getTime()));
    const hi = new Date(a.endsAt ? Math.min(fTo, new Date(a.endsAt).getTime() + 86399000) : fTo);
    return { lo, hi };
  }

  /** Relatório de horas dos alocados — visão da empregadora (cedidas), agrupado por tomadora, com faturamento. */
  async reportOwned(ctx: RequestContext, from?: string, to?: string, borrowerOrgId?: string) {
    this.requireAdmin(ctx);
    const fromD = this.day(from), toD = this.day(to);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.findMany({
      where: { ownerOrgId: ctx.orgId!, status: { in: ["active", "ended"] }, ...(borrowerOrgId ? { borrowerOrgId } : {}), ...(toD ? { startsAt: { lte: toD } } : {}), ...(fromD ? { OR: [{ endsAt: null }, { endsAt: { gte: fromD } }] } : {}) },
      orderBy: { startsAt: "desc" },
    }));
    const empMap = await this.empNames(rows.map((r) => r.pontoEmployeeId));
    const orgMap = await this.orgNames(rows.map((r) => r.borrowerOrgId));
    const out: any[] = [];
    for (const a of rows) {
      const { lo, hi } = this.window(a, from, to);
      const { workedMin, count } = await this.workedMin(a.pontoEmployeeId, lo, hi);
      const rate = a.billRateCents != null ? Number(a.billRateCents) : null;
      const billCents = rate != null ? Math.round(rate * (workedMin / 60)) : null;
      out.push({
        id: a.id, borrowerOrgId: a.borrowerOrgId, borrowerName: orgMap.get(a.borrowerOrgId) ?? "—",
        employeeName: empMap.get(a.pontoEmployeeId)?.name ?? "—", cargo: empMap.get(a.pontoEmployeeId)?.cargo ?? null,
        posto: a.posto, count, workedMin, billRateCents: rate, billCents, status: a.status,
      });
    }
    const byBorrowerMap = new Map<string, any>();
    for (const r of out) { const g = byBorrowerMap.get(r.borrowerOrgId) ?? { borrowerOrgId: r.borrowerOrgId, borrowerName: r.borrowerName, count: 0, workedMin: 0, billCents: 0, hasBill: false }; g.count++; g.workedMin += r.workedMin; if (r.billCents != null) { g.billCents += r.billCents; g.hasBill = true; } byBorrowerMap.set(r.borrowerOrgId, g); }
    const byBorrower = [...byBorrowerMap.values()].sort((a, b) => a.borrowerName.localeCompare(b.borrowerName));
    const totals = out.reduce((t, r) => { t.workedMin += r.workedMin; t.billCents += r.billCents ?? 0; return t; }, { workedMin: 0, billCents: 0 });
    return { from: from ?? null, to: to ?? null, rows: out, byBorrower, totals };
  }

  /** Relatório de horas — visão da tomadora (recebidas). */
  async reportBorrowed(ctx: RequestContext, from?: string, to?: string) {
    this.requireAdmin(ctx);
    const fromD = this.day(from), toD = this.day(to);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.findMany({
      where: { borrowerOrgId: ctx.orgId!, ...(toD ? { startsAt: { lte: toD } } : {}), ...(fromD ? { OR: [{ endsAt: null }, { endsAt: { gte: fromD } }] } : {}) },
      orderBy: { startsAt: "desc" },
    }));
    const empMap = await this.empNames(rows.map((r) => r.pontoEmployeeId));
    const orgMap = await this.orgNames(rows.map((r) => r.ownerOrgId));
    const out: any[] = [];
    for (const a of rows) {
      const { lo, hi } = this.window(a, from, to);
      const { workedMin, count } = await this.workedMin(a.pontoEmployeeId, lo, hi);
      out.push({ id: a.id, employerName: orgMap.get(a.ownerOrgId) ?? "—", employeeName: empMap.get(a.pontoEmployeeId)?.name ?? "—", cargo: empMap.get(a.pontoEmployeeId)?.cargo ?? null, posto: a.posto, count, workedMin });
    }
    const totals = out.reduce((t, r) => { t.workedMin += r.workedMin; return t; }, { workedMin: 0 });
    return { from: from ?? null, to: to ?? null, rows: out, totals };
  }

  private hm(min: number) { const m = Math.round(min || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; }
  private brl(cents: number | null) { return cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  async reportOwnedCsv(ctx: RequestContext, from?: string, to?: string, borrowerOrgId?: string): Promise<string> {
    const r = await this.reportOwned(ctx, from, to, borrowerOrgId);
    const lines = [["Tomadora", "Funcionário", "Cargo", "Posto", "Marcações", "Horas", "Valor/h (R$)", "Total (R$)"].join(";")];
    for (const x of r.rows) lines.push([x.borrowerName, x.employeeName, x.cargo ?? "", x.posto ?? "", String(x.count), this.hm(x.workedMin), this.brl(x.billRateCents), this.brl(x.billCents)].map(csvCell).join(";"));
    lines.push("");
    lines.push(["TOTAL", "", "", "", "", this.hm(r.totals.workedMin), "", this.brl(r.totals.billCents)].map(csvCell).join(";"));
    return "﻿" + lines.join("\r\n");
  }

  /** Fatura (PDF) das horas dos alocados de UMA tomadora no período — emitida pela empregadora. */
  async invoicePdf(ctx: RequestContext, borrowerOrgId: string, from?: string, to?: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireAdmin(ctx);
    if (!borrowerOrgId) throw new AppError(ErrorCode.ValidationFailed, "Selecione a tomadora", 400);
    const rep = await this.reportOwned(ctx, from, to, borrowerOrgId);
    const orgMap = await this.orgNames([ctx.orgId!, borrowerOrgId]);
    const ownerName = orgMap.get(ctx.orgId!) ?? "Empresa";
    const borrowerName = orgMap.get(borrowerOrgId) ?? "Tomadora";
    const own = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { primaryColor: true } })).catch(() => null);
    const accent = own?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(own.primaryColor) ? own.primaryColor : "#111827";
    const hm = (m: number) => this.hm(m);
    const brl = (c: number | null) => c == null ? "—" : `R$ ${this.brl(c)}`;
    const periodo = `${from ? new Date(`${from}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "início"} a ${to ? new Date(`${to}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "hoje"}`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (x) => chunks.push(x as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 40, right = pdf.page.width - M;
      pdf.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(ownerName, M, pdf.y, { lineBreak: false });
      pdf.font("Helvetica-Bold").fontSize(13).fillColor(accent).text("Fatura de horas — mão de obra", M, pdf.y - 18, { width: right - M, align: "right" });
      pdf.moveTo(M, pdf.y + 4).lineTo(right, pdf.y + 4).lineWidth(2).strokeColor(accent).stroke(); pdf.lineWidth(1); pdf.moveDown(0.8);
      pdf.font("Helvetica").fontSize(10).fillColor("#333").text(`Tomadora: ${borrowerName}`, M, pdf.y);
      pdf.fontSize(9).fillColor("#555").text(`Período: ${periodo} · emitido em ${new Date().toLocaleString("pt-BR")}`); pdf.moveDown(0.6);
      const cols = [{ t: "Funcionário", w: 180 }, { t: "Posto", w: 130 }, { t: "Horas", w: 70 }, { t: "Valor/h", w: 80 }, { t: "Total", w: 55 }];
      const head = () => { let x = M; pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111"); for (const c of cols) { pdf.text(c.t, x, pdf.y, { width: c.w, lineBreak: false }); x += c.w; } pdf.moveDown(0.4); };
      head(); pdf.font("Helvetica").fontSize(9).fillColor("#333");
      for (const r of rep.rows as any[]) {
        if (pdf.y > pdf.page.height - 90) { pdf.addPage(); head(); pdf.font("Helvetica").fontSize(9).fillColor("#333"); }
        let x = M; const y = pdf.y;
        [r.employeeName, r.posto ?? "—", hm(r.workedMin), brl(r.billRateCents), brl(r.billCents)].forEach((v, i) => { pdf.text(String(v), x, y, { width: cols[i]!.w, lineBreak: false }); x += cols[i]!.w; });
        pdf.moveDown(0.35);
      }
      if (!rep.rows.length) pdf.fillColor("#999").text("Nenhuma alocação com horas no período.", M, pdf.y);
      pdf.fillColor("#111").moveDown(0.4); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ccc").stroke(); pdf.moveDown(0.3);
      pdf.font("Helvetica-Bold").fontSize(11).text(`Total de horas: ${hm(rep.totals.workedMin)}     Total a faturar: ${brl(rep.totals.billCents)}`, M, pdf.y);
      pdf.font("Helvetica").fontSize(7).fillColor("#888").text("Documento gerencial de apuração de horas para faturamento de cessão de mão de obra. O vínculo empregatício é da empresa emissora.", M, pdf.y + 8);
      pdf.end();
    });
    return { buffer, filename: `fatura-${borrowerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${from ?? ""}_${to ?? ""}.pdf` };
  }

  /** Batidas de um alocado (borrower) — valida a alocação e lê as batidas no contexto da empregadora. */
  async borrowedPunches(ctx: RequestContext, allocationId: string, from?: string, to?: string) {
    this.requireAdmin(ctx);
    // a RLS de borrower só retorna alocações vigentes destinadas a esta org
    const alloc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoAllocation.findFirst({ where: { id: allocationId, borrowerOrgId: ctx.orgId! }, select: { pontoEmployeeId: true, startsAt: true, endsAt: true } }));
    if (!alloc) throw new AppError(ErrorCode.Forbidden, "Alocação não encontrada ou encerrada", 403);
    // janela: interseção entre o filtro e o período da alocação
    const lo = new Date(Math.max(this.day(from)?.getTime() ?? 0, new Date(alloc.startsAt).getTime()));
    const hiBase = this.day(to) ?? new Date();
    const hi = alloc.endsAt ? new Date(Math.min(hiBase.getTime(), new Date(alloc.endsAt).getTime() + 86399000)) : hiBase;
    // lê batidas na empregadora (contexto interno) — só do funcionário alocado
    const punches = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoPunch.findMany({
      where: { employeeId: alloc.pontoEmployeeId, voided: false, punchedAt: { gte: lo, lte: hi } },
      orderBy: { punchedAt: "asc" }, select: { punchedAt: true, origin: true },
    }));
    // total trabalhado (pares entrada/saída)
    let workedMin = 0;
    for (let i = 0; i + 1 < punches.length; i += 2) workedMin += Math.max(0, Math.round((new Date(punches[i + 1]!.punchedAt).getTime() - new Date(punches[i]!.punchedAt).getTime()) / 60000));
    return { items: punches.map((p) => ({ at: p.punchedAt, origin: p.origin })), count: punches.length, workedMin };
  }
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
