import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { FolhaService } from "./folha.service";
import type { RequestContext } from "../auth/session.middleware";

/** Relatórios gerenciais consolidados (horas extras, absenteísmo/atrasos, extrato de batidas). */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly folha: FolhaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }

  private hm(min: number): string { const m = Math.round(Math.abs(min || 0)); const s = min < 0 ? "-" : ""; return `${s}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
  private async storeNames(ctx: RequestContext): Promise<Map<string, string>> {
    const stores = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findMany({ where: {}, select: { id: true, name: true } })).catch(() => [] as any[]);
    return new Map((stores as any[]).map((s) => [s.id, s.name] as const));
  }

  /** Consolidado mensal por funcionário + agregados por loja (base de HE e absenteísmo). */
  async consolidated(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const sum = await this.folha.summary(ctx, refMonth);
    const sn = await this.storeNames(ctx);
    const rows = (sum.rows as any[]).map((r) => {
      const storeName = r.storeId ? (sn.get(r.storeId) ?? "—") : "Sem loja";
      const absRate = r.expectedMin > 0 ? Math.round(((r.faltaMin || 0) / r.expectedMin) * 1000) / 10 : 0;
      return {
        employeeId: r.employeeId, name: r.name, cargo: r.cargo ?? null, storeId: r.storeId ?? null, storeName,
        expectedMin: r.expectedMin || 0, workedMin: r.workedMin || 0, extraMin: r.extraMin || 0, extra50Min: r.extra50Min || 0, extra100Min: r.extra100Min || 0, nightMin: r.nightMin || 0,
        lateMin: r.lateMin || 0, faltaMin: r.faltaMin || 0, balanceMin: r.balanceMin || 0, bankBalanceMin: r.bankBalanceMin || 0,
        absRate,
      };
    });
    // agregados por loja
    const byStoreMap = new Map<string, any>();
    for (const r of rows) {
      const k = r.storeId ?? "none";
      const g = byStoreMap.get(k) ?? { storeId: r.storeId, storeName: r.storeName, headcount: 0, expectedMin: 0, workedMin: 0, extraMin: 0, extra50Min: 0, extra100Min: 0, nightMin: 0, lateMin: 0, faltaMin: 0, balanceMin: 0 };
      g.headcount++; g.expectedMin += r.expectedMin; g.workedMin += r.workedMin; g.extraMin += r.extraMin; g.extra50Min += r.extra50Min; g.extra100Min += r.extra100Min; g.nightMin += r.nightMin; g.lateMin += r.lateMin; g.faltaMin += r.faltaMin; g.balanceMin += r.balanceMin;
      byStoreMap.set(k, g);
    }
    const byStore = [...byStoreMap.values()].map((g) => ({ ...g, absRate: g.expectedMin > 0 ? Math.round((g.faltaMin / g.expectedMin) * 1000) / 10 : 0 })).sort((a, b) => a.storeName.localeCompare(b.storeName));
    const totals = rows.reduce((t, r) => { t.expectedMin += r.expectedMin; t.workedMin += r.workedMin; t.extraMin += r.extraMin; t.extra50Min += r.extra50Min; t.extra100Min += r.extra100Min; t.nightMin += r.nightMin; t.lateMin += r.lateMin; t.faltaMin += r.faltaMin; t.balanceMin += r.balanceMin; return t; }, { expectedMin: 0, workedMin: 0, extraMin: 0, extra50Min: 0, extra100Min: 0, nightMin: 0, lateMin: 0, faltaMin: 0, balanceMin: 0 });
    return { refMonth: sum.refMonth, from: sum.from, to: sum.to, rows, byStore, totals, hm: true };
  }

  /** CSV do consolidado (HE + faltas/atrasos por funcionário e loja). */
  async consolidatedCsv(ctx: RequestContext, refMonth: string): Promise<string> {
    const c = await this.consolidated(ctx, refMonth);
    const head = ["Loja", "Funcionário", "Cargo", "Previsto", "Trabalhado", "HE 50%", "HE 100%", "Extra total", "Noturno", "Atraso", "Falta", "Saldo", "Banco", "Absenteísmo %"];
    const lines = [head.join(";")];
    for (const r of c.rows.sort((a: any, b: any) => a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name))) {
      lines.push([r.storeName, r.name, r.cargo ?? "", this.hm(r.expectedMin), this.hm(r.workedMin), this.hm(r.extra50Min), this.hm(r.extra100Min), this.hm(r.extraMin), this.hm(r.nightMin), this.hm(r.lateMin), this.hm(r.faltaMin), this.hm(r.balanceMin), this.hm(r.bankBalanceMin), String(r.absRate).replace(".", ",")].map(csvCell).join(";"));
    }
    lines.push("");
    lines.push(["TOTAL", "", "", this.hm(c.totals.expectedMin), this.hm(c.totals.workedMin), this.hm(c.totals.extra50Min), this.hm(c.totals.extra100Min), this.hm(c.totals.extraMin), this.hm(c.totals.nightMin), this.hm(c.totals.lateMin), this.hm(c.totals.faltaMin), this.hm(c.totals.balanceMin), "", ""].map(csvCell).join(";"));
    return "﻿" + lines.join("\r\n");
  }

  /** PDF gerencial do consolidado (agrupado por loja, com totais por loja e geral). */
  async consolidatedPdf(ctx: RequestContext, refMonth: string): Promise<{ buffer: Buffer; filename: string }> {
    const c = await this.consolidated(ctx, refMonth);
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, primaryColor: true } })).catch(() => null);
    const accent = org?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(org.primaryColor) ? org.primaryColor : "#111827";
    const hm = (m: number) => this.hm(m);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
      const chunks: Buffer[] = []; pdf.on("data", (x) => chunks.push(x as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 36, right = pdf.page.width - M;
      // cabeçalho
      pdf.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(org?.name || "Empresa", M, pdf.y, { lineBreak: false });
      pdf.font("Helvetica-Bold").fontSize(13).fillColor(accent).text("Relatório Consolidado de Ponto", M, pdf.y - 18, { width: right - M, align: "right" });
      pdf.font("Helvetica").fontSize(9).fillColor("#555").text(`Competência ${c.refMonth} · gerado em ${new Date().toLocaleString("pt-BR")}`, M, pdf.y + 2);
      pdf.moveTo(M, pdf.y + 4).lineTo(right, pdf.y + 4).lineWidth(2).strokeColor(accent).stroke(); pdf.lineWidth(1); pdf.moveDown(1);

      const cols = [{ t: "Funcionário", w: 150 }, { t: "Cargo", w: 95 }, { t: "Trab.", w: 55 }, { t: "HE 50%", w: 55 }, { t: "HE 100%", w: 58 }, { t: "Not.", w: 50 }, { t: "Atraso", w: 52 }, { t: "Falta", w: 52 }, { t: "Saldo", w: 55 }, { t: "Abs.%", w: 45 }];
      const drawHead = () => { let x = M; pdf.font("Helvetica-Bold").fontSize(8).fillColor("#111"); for (const col of cols) { pdf.text(col.t, x, pdf.y, { width: col.w, lineBreak: false }); x += col.w; } pdf.moveDown(0.4); };
      const drawRow = (vals: string[], bold = false, color = "#333") => {
        if (pdf.y > pdf.page.height - 60) { pdf.addPage(); drawHead(); }
        let x = M; const y = pdf.y; pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(color);
        vals.forEach((v, i) => { pdf.text(v, x, y, { width: cols[i]!.w, lineBreak: false }); x += cols[i]!.w; });
        pdf.moveDown(0.32);
      };

      for (const g of c.byStore) {
        pdf.moveDown(0.3); pdf.font("Helvetica-Bold").fontSize(10).fillColor(accent).text(`${g.storeName}  ·  ${g.headcount} func.`, M, pdf.y); pdf.moveDown(0.2);
        drawHead();
        const emps = c.rows.filter((r: any) => (r.storeId ?? null) === (g.storeId ?? null)).sort((a: any, b: any) => a.name.localeCompare(b.name));
        for (const r of emps) drawRow([r.name, r.cargo ?? "", hm(r.workedMin), hm(r.extra50Min), hm(r.extra100Min), hm(r.nightMin), hm(r.lateMin), hm(r.faltaMin), hm(r.balanceMin), `${r.absRate}%`], false, r.balanceMin < 0 ? "#a00" : "#333");
        drawRow([`Subtotal ${g.storeName}`, "", "", hm(g.extra50Min), hm(g.extra100Min), hm(g.nightMin), hm(g.lateMin), hm(g.faltaMin), hm(g.balanceMin), `${g.absRate}%`], true, "#111");
      }
      pdf.moveDown(0.4); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ccc").stroke(); pdf.moveDown(0.3);
      drawRow(["TOTAL GERAL", "", hm(c.totals.workedMin), hm(c.totals.extra50Min), hm(c.totals.extra100Min), hm(c.totals.nightMin), hm(c.totals.lateMin), hm(c.totals.faltaMin), hm(c.totals.balanceMin), ""], true, "#000");
      pdf.font("Helvetica").fontSize(7).fillColor("#888").text("HE 100% = domingos/feriados; HE 50% = demais dias. Abs.% = faltas/horas previstas.", M, pdf.y + 6);
      pdf.end();
    });
    return { buffer, filename: `consolidado-${c.refMonth}.pdf` };
  }

  /** Extrato de marcações brutas (não-fiscal) por período → CSV simples. */
  async punchesCsv(ctx: RequestContext, from: string, to: string, opts?: { storeId?: string | null }): Promise<string> {
    this.requireAdmin(ctx);
    const start = new Date(`${from}T00:00:00`); const end = new Date(`${to}T23:59:59.999`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new AppError(ErrorCode.ValidationFailed, "Período inválido", 400);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { ...(opts?.storeId ? { storeId: opts.storeId } : {}) }, select: { id: true, name: true, cpf: true, storeId: true } }));
    const empMap = new Map(emps.map((e) => [e.id, e] as const));
    const empIds = emps.map((e) => e.id);
    const sn = await this.storeNames(ctx);
    const punches = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findMany({
      where: { punchedAt: { gte: start, lte: end }, ...(empIds.length ? { employeeId: { in: empIds } } : {}) },
      orderBy: [{ employeeId: "asc" }, { punchedAt: "asc" }],
      select: { employeeId: true, punchedAt: true, origin: true, source: true, nsr: true },
    }));
    const head = ["Loja", "Funcionário", "CPF", "Data", "Hora", "Origem", "NSR"];
    const lines = [head.join(";")];
    for (const p of punches) {
      const e = empMap.get(p.employeeId);
      const storeName = e?.storeId ? (sn.get(e.storeId) ?? "—") : "—";
      const d = new Date(p.punchedAt);
      const data = d.toLocaleDateString("pt-BR");
      const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      lines.push([storeName, e?.name ?? "—", e?.cpf ?? "", data, hora, p.origin ?? "", String(p.nsr ?? "")].map(csvCell).join(";"));
    }
    return "﻿" + lines.join("\r\n");
  }
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
