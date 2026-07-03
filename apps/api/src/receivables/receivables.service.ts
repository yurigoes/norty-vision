import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OrgAiService } from "../ai/org-ai.service";
import type { RequestContext } from "../auth/session.middleware";

interface InstallmentInput { number?: number; dueDate: string; amountCents: number }
interface CreateReceivableInput {
  payer?: string | null; description?: string | null; category?: string | null;
  docType?: string; docNumber?: string | null; issueDate?: string | null;
  storeId?: string | null; notes?: string | null; installments: InstallmentInput[];
  recurring?: boolean; recurrenceDay?: number; recurrenceAmountCents?: number; recurrenceUntil?: string | null;
}

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger("Receivables");
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly ai: OrgAiService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403); }
  private requireAdmin(ctx: RequestContext) { this.requireOrg(ctx); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private parseDataUrl(s: string): { contentType: string; buf: Buffer } {
    const m = (s || "").match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Arquivo inválido", 400);
    const buf = Buffer.from(m[2]!, "base64");
    if (!buf.length || buf.length > 12_000_000) throw new AppError(ErrorCode.ValidationFailed, "Arquivo inválido ou maior que 12MB", 400);
    return { contentType: m[1]!, buf };
  }

  // ---------------- CRUD título ----------------
  async create(ctx: RequestContext, input: CreateReceivableInput) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const recurring = !!input.recurring;
    const recDay = recurring ? Math.min(28, Math.max(1, Math.trunc(Number(input.recurrenceDay) || 1))) : null;
    const recAmount = recurring ? Math.max(0, Math.round(Number(input.recurrenceAmountCents) || 0)) : null;
    let insts = (input.installments ?? []).filter((i) => i?.dueDate).map((i, idx) => ({
      number: i.number ?? idx + 1,
      dueDate: new Date(i.dueDate + "T00:00:00Z"),
      amountCents: Math.max(0, Math.round(Number(i.amountCents) || 0)),
    }));
    if (recurring && !insts.length && recAmount! > 0) {
      const now = new Date(); const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), recDay!));
      insts = [{ number: 1, dueDate: due, amountCents: recAmount! }];
    }
    if (!insts.length) throw new AppError(ErrorCode.ValidationFailed, "Informe ao menos uma parcela (ou valor mensal, se recorrente)", 400);
    const total = insts.reduce((s, i) => s + i.amountCents, 0);
    const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivable.create({
      data: {
        organizationId: orgId, storeId: input.storeId ?? null,
        payer: (input.payer || "").slice(0, 200) || null, description: (input.description || "").slice(0, 400) || null,
        category: (input.category || "").slice(0, 80) || null, docType: recurring ? "recorrente" : (["avulso", "venda"].includes(input.docType ?? "") ? input.docType! : "avulso"),
        docNumber: (input.docNumber || "").slice(0, 60) || null,
        totalCents: BigInt(total), issueDate: input.issueDate ? new Date(input.issueDate + "T00:00:00Z") : null,
        notes: (input.notes || "").slice(0, 1000) || null, createdBy: ctx.userId ?? null,
        recurring, recurrenceDay: recDay, recurrenceAmountCents: recAmount != null ? BigInt(recAmount) : null,
        recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil + "T00:00:00Z") : null,
        recurrenceLast: recurring ? firstOfMonth : null,
        installments: { create: insts.map((i) => ({ organizationId: orgId, number: i.number, dueDate: i.dueDate, amountCents: BigInt(i.amountCents) })) },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    }));
  }

  /** Lista parcelas (com o título) por status derivado + período de vencimento. */
  async list(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const where: any = {};
    if (opts.status === "recebido") where.status = "recebido";
    else if (opts.status === "atrasado") { where.status = "a_receber"; where.dueDate = { lt: today }; }
    else if (opts.status === "a_vencer") { where.status = "a_receber"; where.dueDate = { gte: today }; }
    else if (opts.status === "a_receber") where.status = "a_receber";
    if (opts.from || opts.to) where.dueDate = { ...(where.dueDate ?? {}), ...(opts.from ? { gte: new Date(opts.from + "T00:00:00Z") } : {}), ...(opts.to ? { lte: new Date(opts.to + "T23:59:59Z") } : {}) };
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableInstallment.findMany({
      where, orderBy: [{ dueDate: "asc" }], take: 1000,
      include: { receivable: { select: { id: true, payer: true, description: true, category: true, docType: true, docNumber: true } } },
    }));
    const search = (opts.search || "").trim().toLowerCase();
    const items = rows
      .filter((r: any) => !search || `${r.receivable?.payer ?? ""} ${r.receivable?.description ?? ""} ${r.receivable?.docNumber ?? ""}`.toLowerCase().includes(search))
      .map((r: any) => ({ ...r, amountCents: Number(r.amountCents), paidCents: r.paidCents != null ? Number(r.paidCents) : null, overdue: r.status === "a_receber" && new Date(r.dueDate) < today }));
    return { items };
  }

  async getById(ctx: RequestContext, receivableId: string) {
    this.requireOrg(ctx);
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivable.findFirst({
      where: { id: receivableId }, include: { installments: { orderBy: { number: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } },
    }));
    if (!r) throw new AppError(ErrorCode.NotFound, "Título não encontrado", 404);
    return r;
  }

  async remove(ctx: RequestContext, receivableId: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivable.deleteMany({ where: { id: receivableId } }));
    return { ok: true };
  }

  // ---------------- baixa (recebimento) ----------------
  async receiveInstallment(ctx: RequestContext, installmentId: string, input: { paidCents?: number; paidAt?: string; paymentMethod?: string; notes?: string; proof?: string; proofName?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const inst = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableInstallment.findFirst({ where: { id: installmentId } }));
    if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela não encontrada", 404);
    let proofUrl: string | null = inst.proofUrl;
    if (input.proof) {
      const { contentType, buf } = this.parseDataUrl(input.proof);
      const { key } = await this.storage.putPrivate({ keyPrefix: `receivables/${orgId}/proofs`, contentType, body: buf, originalName: input.proofName });
      proofUrl = key;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableAttachment.create({ data: { organizationId: orgId, receivableId: inst.receivableId, installmentId: inst.id, kind: "comprovante", url: key, filename: input.proofName ?? null } }));
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableInstallment.update({
      where: { id: installmentId },
      data: {
        status: "recebido",
        paidCents: BigInt(Math.max(0, Math.round(input.paidCents ?? Number(inst.amountCents)))),
        paidAt: input.paidAt ? new Date(input.paidAt + "T00:00:00Z") : new Date(),
        paymentMethod: (input.paymentMethod || "").slice(0, 40) || null,
        notes: input.notes != null ? (input.notes || "").slice(0, 1000) || null : inst.notes,
        proofUrl,
      },
    }));
  }

  async setInstallmentStatus(ctx: RequestContext, installmentId: string, status: "a_receber" | "cancelado") {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableInstallment.update({
      where: { id: installmentId }, data: status === "a_receber" ? { status: "a_receber", paidAt: null, paidCents: null, paymentMethod: null } : { status: "cancelado" },
    }));
  }

  // ---------------- anexos ----------------
  async addAttachment(ctx: RequestContext, input: { receivableId?: string; installmentId?: string; kind?: string; data: string; filename?: string; extracted?: any }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.receivableId && !input.installmentId) throw new AppError(ErrorCode.ValidationFailed, "Informe o título ou a parcela", 400);
    const { contentType, buf } = this.parseDataUrl(input.data);
    const kind = ["comprovante", "outro"].includes(input.kind ?? "") ? input.kind! : "outro";
    const { key } = await this.storage.putPrivate({ keyPrefix: `receivables/${orgId}/${kind}`, contentType, body: buf, originalName: input.filename });
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableAttachment.create({
      data: { organizationId: orgId, receivableId: input.receivableId ?? null, installmentId: input.installmentId ?? null, kind, url: key, filename: input.filename ?? null, extracted: input.extracted ?? {} },
    }));
  }

  async attachmentFile(ctx: RequestContext, id: string): Promise<{ body: Buffer; contentType: string; filename: string }> {
    this.requireOrg(ctx);
    const att = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.receivableAttachment.findFirst({ where: { id } }));
    if (!att) throw new AppError(ErrorCode.NotFound, "Anexo não encontrado", 404);
    const f = await this.storage.getPrivate(att.url);
    return { body: f.body, contentType: f.contentType, filename: att.filename ?? "anexo" };
  }

  // ---------------- relatórios ----------------
  /** Resumo: a vencer / atrasado / a receber (total aberto) / recebido no período + por categoria. */
  async summary(ctx: RequestContext, opts: { from?: string; to?: string }) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = opts.from ? new Date(opts.from + "T00:00:00Z") : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = opts.to ? new Date(opts.to + "T23:59:59Z") : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59));
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const open = await tx.receivableInstallment.findMany({ where: { status: "a_receber" }, select: { dueDate: true, amountCents: true, receivable: { select: { category: true } } } });
      let aVencerC = 0, aVencerV = 0, atrasadoC = 0, atrasadoV = 0;
      const cat = new Map<string, number>();
      for (const i of open) {
        const v = Number(i.amountCents);
        if (new Date(i.dueDate) < today) { atrasadoC++; atrasadoV += v; } else { aVencerC++; aVencerV += v; }
        const c = (i.receivable?.category || "sem categoria").toLowerCase();
        cat.set(c, (cat.get(c) ?? 0) + v);
      }
      const recebidos = await tx.receivableInstallment.findMany({ where: { status: "recebido", paidAt: { gte: start, lte: end } }, select: { paidCents: true, amountCents: true } });
      const recebidoV = recebidos.reduce((s, p) => s + Number(p.paidCents ?? p.amountCents), 0);
      return {
        period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
        aVencer: { count: aVencerC, cents: aVencerV },
        atrasado: { count: atrasadoC, cents: atrasadoV },
        aReceberTotal: { count: aVencerC + atrasadoC, cents: aVencerV + atrasadoV },
        recebidoPeriodo: { count: recebidos.length, cents: recebidoV },
        porCategoria: [...cat.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
      };
    });
  }

  /** Export CSV da lista (mesmos filtros da tela). */
  async exportCsv(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const { items } = await this.list(ctx, opts);
    const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    const rows: string[] = ["Pagador;Descricao;Categoria;Documento;Parcela;Vencimento;Valor;Status;Recebido em;Meio;Valor recebido"];
    for (const it of items as any[]) {
      const st = it.status === "recebido" ? "recebido" : it.overdue ? "atrasado" : "a_receber";
      rows.push([
        it.receivable?.payer ?? "", it.receivable?.description ?? "", it.receivable?.category ?? "", it.receivable?.docNumber ?? "",
        it.number, String(it.dueDate).slice(0, 10), money(Number(it.amountCents)), st,
        it.paidAt ? String(it.paidAt).slice(0, 10) : "", it.paymentMethod ?? "", it.paidCents != null ? money(Number(it.paidCents)) : "",
      ].map((c) => String(c).replace(/;/g, ",")).join(";"));
    }
    const buffer = Buffer.from("﻿" + rows.join("\r\n"), "utf8");
    return { buffer, filename: `contas-a-receber-${opts.status ?? "todas"}-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  /** Relatório PDF (resumo + lista) das contas a receber. */
  async reportPdf(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const [{ items }, sum, org] = await Promise.all([
      this.list(ctx, opts),
      this.summary(ctx, { from: opts.from, to: opts.to }),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true } })).catch(() => null),
    ]);
    const money = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 40, W = pdf.page.width, right = W - M;
      pdf.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(org?.name ?? "Empresa", M, 40);
      pdf.font("Helvetica").fontSize(11).fillColor("#555").text("Relatório de contas a receber", M);
      const statusLbl: any = { a_receber: "A receber", a_vencer: "A vencer", atrasado: "Atrasado", recebido: "Recebido" };
      pdf.fontSize(9).text(`Filtro: ${statusLbl[opts.status ?? ""] ?? "todas"}${opts.from || opts.to ? ` · ${opts.from ?? ""} a ${opts.to ?? ""}` : ""} · emitido em ${new Date().toLocaleString("pt-BR")}`);
      pdf.moveDown(0.6); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Resumo");
      pdf.font("Helvetica").fontSize(10).fillColor("#333");
      pdf.text(`A vencer: ${sum.aVencer.count} · ${money(sum.aVencer.cents)}    |    Atrasado: ${sum.atrasado.count} · ${money(sum.atrasado.cents)}`);
      pdf.text(`Total a receber (aberto): ${sum.aReceberTotal.count} · ${money(sum.aReceberTotal.cents)}    |    Recebido no período: ${sum.recebidoPeriodo.count} · ${money(sum.recebidoPeriodo.cents)}`);
      pdf.moveDown(0.6); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
      const cols = [{ t: "Pagador / descrição", w: 200 }, { t: "Venc.", w: 70 }, { t: "Valor", w: 90 }, { t: "Status", w: 70 }];
      const drawHead = () => { let cx = M; pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111"); cols.forEach((c) => { pdf.text(c.t, cx, pdf.y, { width: c.w, lineBreak: false, continued: false }); cx += c.w; }); pdf.moveDown(0.3); };
      drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333");
      for (const it of items as any[]) {
        if (pdf.y > pdf.page.height - 60) { pdf.addPage(); drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333"); }
        const st = it.status === "recebido" ? "recebido" : it.overdue ? "atrasado" : "a receber";
        const name = (it.receivable?.payer || it.receivable?.description || "—").slice(0, 42);
        const y = pdf.y; let cx = M;
        pdf.text(name, cx, y, { width: cols[0]!.w, lineBreak: false }); cx += cols[0]!.w;
        pdf.text(new Date(it.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" }), cx, y, { width: cols[1]!.w, lineBreak: false }); cx += cols[1]!.w;
        pdf.text(money(Number(it.amountCents)), cx, y, { width: cols[2]!.w, lineBreak: false }); cx += cols[2]!.w;
        pdf.fillColor(st === "atrasado" ? "#b00" : st === "recebido" ? "#0a0" : "#333").text(st, cx, y, { width: cols[3]!.w, lineBreak: false }); pdf.fillColor("#333");
        pdf.moveDown(0.4);
      }
      pdf.end();
    });
    return { buffer, filename: `contas-a-receber-${opts.status ?? "todas"}-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  // ---------------- OCR/IA do comprovante ----------------
  /** Lê uma imagem (comprovante/nota) com a IA da empresa (visão) e extrai os campos. */
  async ocrDocument(ctx: RequestContext, input: { data: string }): Promise<any> {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    this.parseDataUrl(input.data);
    const system = "Você extrai dados de documentos financeiros brasileiros (comprovante de recebimento, nota, recibo). Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem markdown.";
    const user = [
      "Extraia destes campos o que conseguir identificar na imagem e devolva em JSON:",
      '{ "payer": string|null (pagador/cliente), "description": string|null, "category": string|null (ex.: serviço, venda, mensalidade), "docNumber": string|null, "dueDate": "YYYY-MM-DD"|null (data do documento/recebimento), "amountCents": number|null (valor TOTAL em CENTAVOS, inteiro) }',
      "Regras: valores em centavos (R$ 1.234,56 => 123456). Datas no formato ISO. Se não tiver certeza, use null. Não invente.",
    ].join("\n");
    const raw = await this.ai.completeVision(orgId, system, user, input.data, 600).catch(() => null);
    if (!raw) return { available: false, message: "Sem IA com visão configurada para a empresa." };
    const parsed = this.parseJsonLoose(raw);
    if (!parsed) return { available: true, parsed: null, message: "A IA não retornou um JSON válido." };
    return {
      available: true,
      parsed: {
        payer: typeof parsed.payer === "string" ? parsed.payer.slice(0, 200) : null,
        description: typeof parsed.description === "string" ? parsed.description.slice(0, 400) : null,
        category: typeof parsed.category === "string" ? parsed.category.slice(0, 80) : null,
        docNumber: typeof parsed.docNumber === "string" ? parsed.docNumber.slice(0, 60) : (parsed.docNumber != null ? String(parsed.docNumber).slice(0, 60) : null),
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.dueDate ?? "")) ? String(parsed.dueDate) : null,
        amountCents: Number.isFinite(Number(parsed.amountCents)) && Number(parsed.amountCents) > 0 ? Math.round(Number(parsed.amountCents)) : null,
      },
    };
  }

  private parseJsonLoose(s: string): any | null {
    if (!s) return null;
    let t = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    try { return JSON.parse(t); } catch { return null; }
  }

  // ============================================================================
  // FLUXO DE CAIXA — entradas (recebíveis recebidos) x saídas (pagáveis pagos),
  // realizado por mês no período + previsto (em aberto) por mês + saldo.
  // ============================================================================
  async cashflow(ctx: RequestContext, opts: { from?: string; to?: string }) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    // janela padrão: 6 meses (mês corrente -2 … +3) para enxergar realizado + previsto
    const baseY = today.getUTCFullYear(), baseM = today.getUTCMonth();
    const start = opts.from ? new Date(opts.from + "T00:00:00Z") : new Date(Date.UTC(baseY, baseM - 2, 1));
    const end = opts.to ? new Date(opts.to + "T23:59:59Z") : new Date(Date.UTC(baseY, baseM + 4, 0, 23, 59, 59));
    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      // realizado: por data de pagamento/recebimento
      const recebidos = await tx.receivableInstallment.findMany({ where: { status: "recebido", paidAt: { gte: start, lte: end } }, select: { paidAt: true, paidCents: true, amountCents: true } });
      const pagos = await tx.payableInstallment.findMany({ where: { status: "pago", paidAt: { gte: start, lte: end } }, select: { paidAt: true, paidCents: true, amountCents: true } });
      // previsto: em aberto, por data de vencimento
      const aReceber = await tx.receivableInstallment.findMany({ where: { status: "a_receber", dueDate: { gte: start, lte: end } }, select: { dueDate: true, amountCents: true } });
      const aPagar = await tx.payableInstallment.findMany({ where: { status: "a_pagar", dueDate: { gte: start, lte: end } }, select: { dueDate: true, amountCents: true } });

      const months = new Map<string, { entradas: number; saidas: number; previstoEntrada: number; previstoSaida: number }>();
      const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      while (m <= end) { months.set(monthKey(m), { entradas: 0, saidas: 0, previstoEntrada: 0, previstoSaida: 0 }); m.setUTCMonth(m.getUTCMonth() + 1); }
      const bump = (d: Date | null, field: "entradas" | "saidas" | "previstoEntrada" | "previstoSaida", cents: number) => {
        if (!d) return; const k = monthKey(new Date(d)); const row = months.get(k); if (row) row[field] += cents;
      };
      for (const r of recebidos) bump(r.paidAt, "entradas", Number(r.paidCents ?? r.amountCents));
      for (const p of pagos) bump(p.paidAt, "saidas", Number(p.paidCents ?? p.amountCents));
      for (const r of aReceber) bump(r.dueDate, "previstoEntrada", Number(r.amountCents));
      for (const p of aPagar) bump(p.dueDate, "previstoSaida", Number(p.amountCents));

      let totEnt = 0, totSai = 0, totPrevEnt = 0, totPrevSai = 0;
      const meses = [...months.entries()].map(([month, v]) => {
        totEnt += v.entradas; totSai += v.saidas; totPrevEnt += v.previstoEntrada; totPrevSai += v.previstoSaida;
        return { month, ...v, saldo: v.entradas - v.saidas, saldoPrevisto: v.previstoEntrada - v.previstoSaida };
      });
      return {
        period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
        meses,
        totais: {
          entradas: totEnt, saidas: totSai, saldo: totEnt - totSai,
          previstoEntrada: totPrevEnt, previstoSaida: totPrevSai, saldoPrevisto: totPrevEnt - totPrevSai,
        },
      };
    });
  }

  /** PDF do fluxo de caixa (tabela por mês + totais). */
  async cashflowPdf(ctx: RequestContext, opts: { from?: string; to?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const [cf, org] = await Promise.all([
      this.cashflow(ctx, opts),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true } })).catch(() => null),
    ]);
    const money = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    const mLabel = (k: string) => { const [y, mm] = k.split("-"); return `${mm}/${y}`; };
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 40, W = pdf.page.width, right = W - M;
      pdf.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(org?.name ?? "Empresa", M, 40);
      pdf.font("Helvetica").fontSize(11).fillColor("#555").text("Fluxo de caixa", M);
      pdf.fontSize(9).text(`Período ${cf.period.from} a ${cf.period.to} · emitido em ${new Date().toLocaleString("pt-BR")}`);
      pdf.moveDown(0.6); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
      const cols = [{ t: "Mês", w: 70 }, { t: "Entradas", w: 95 }, { t: "Saídas", w: 95 }, { t: "Saldo", w: 95 }, { t: "Previsto", w: 95 }];
      const drawHead = () => { let cx = M; pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111"); cols.forEach((c) => { pdf.text(c.t, cx, pdf.y, { width: c.w, lineBreak: false }); cx += c.w; }); pdf.moveDown(0.3); };
      drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333");
      for (const m of cf.meses) {
        if (pdf.y > pdf.page.height - 60) { pdf.addPage(); drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333"); }
        const y = pdf.y; let cx = M;
        pdf.fillColor("#333").text(mLabel(m.month), cx, y, { width: cols[0]!.w, lineBreak: false }); cx += cols[0]!.w;
        pdf.fillColor("#0a0").text(money(m.entradas), cx, y, { width: cols[1]!.w, lineBreak: false }); cx += cols[1]!.w;
        pdf.fillColor("#b00").text(money(m.saidas), cx, y, { width: cols[2]!.w, lineBreak: false }); cx += cols[2]!.w;
        pdf.fillColor(m.saldo < 0 ? "#b00" : "#111").text(money(m.saldo), cx, y, { width: cols[3]!.w, lineBreak: false }); cx += cols[3]!.w;
        pdf.fillColor("#555").text(money(m.saldoPrevisto), cx, y, { width: cols[4]!.w, lineBreak: false });
        pdf.moveDown(0.4);
      }
      pdf.moveDown(0.4); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.3);
      pdf.font("Helvetica-Bold").fontSize(10).fillColor("#111");
      pdf.text(`Total entradas: ${money(cf.totais.entradas)}   ·   Total saídas: ${money(cf.totais.saidas)}   ·   Saldo: ${money(cf.totais.saldo)}`);
      pdf.font("Helvetica").fontSize(9).fillColor("#555").text(`Previsto (em aberto) — entradas ${money(cf.totais.previstoEntrada)} · saídas ${money(cf.totais.previstoSaida)} · saldo ${money(cf.totais.saldoPrevisto)}`);
      pdf.end();
    });
    return { buffer, filename: `fluxo-de-caixa-${new Date().toISOString().slice(0, 10)}.pdf` };
  }
}
