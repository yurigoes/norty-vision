import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { XMLParser } from "fast-xml-parser";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OrgAiService } from "../ai/org-ai.service";
import type { RequestContext } from "../auth/session.middleware";

interface InstallmentInput { number?: number; dueDate: string; amountCents: number; barcode?: string | null }
interface CreatePayableInput {
  supplier?: string | null; description?: string | null; category?: string | null;
  docType?: string; docNumber?: string | null; nfeKey?: string | null; issueDate?: string | null;
  storeId?: string | null; notes?: string | null; installments: InstallmentInput[];
  recurring?: boolean; recurrenceDay?: number; recurrenceAmountCents?: number; recurrenceUntil?: string | null;
}

@Injectable()
export class PayablesService {
  private readonly logger = new Logger("Payables");
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

  // ---------------- CRUD conta ----------------
  async create(ctx: RequestContext, input: CreatePayableInput) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const recurring = !!input.recurring;
    const recDay = recurring ? Math.min(28, Math.max(1, Math.trunc(Number(input.recurrenceDay) || 1))) : null;
    const recAmount = recurring ? Math.max(0, Math.round(Number(input.recurrenceAmountCents) || 0)) : null;
    let insts = (input.installments ?? []).filter((i) => i?.dueDate).map((i, idx) => ({
      number: i.number ?? idx + 1,
      dueDate: new Date(i.dueDate + "T00:00:00Z"),
      amountCents: Math.max(0, Math.round(Number(i.amountCents) || 0)),
      barcode: (i.barcode || "").trim() || null,
    }));
    // recorrente sem parcela informada: gera a do mês atual no dia configurado.
    if (recurring && !insts.length && recAmount! > 0) {
      const now = new Date(); const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), recDay!));
      insts = [{ number: 1, dueDate: due, amountCents: recAmount!, barcode: null }];
    }
    if (!insts.length) throw new AppError(ErrorCode.ValidationFailed, "Informe ao menos uma parcela (ou valor mensal, se recorrente)", 400);
    const total = insts.reduce((s, i) => s + i.amountCents, 0);
    const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payable.create({
      data: {
        organizationId: orgId, storeId: input.storeId ?? null,
        supplier: (input.supplier || "").slice(0, 200) || null, description: (input.description || "").slice(0, 400) || null,
        category: (input.category || "").slice(0, 80) || null, docType: recurring ? "recorrente" : (["boleto", "danfe", "avulso"].includes(input.docType ?? "") ? input.docType! : "avulso"),
        docNumber: (input.docNumber || "").slice(0, 60) || null, nfeKey: (input.nfeKey || "").replace(/\D/g, "").slice(0, 44) || null,
        totalCents: BigInt(total), issueDate: input.issueDate ? new Date(input.issueDate + "T00:00:00Z") : null,
        notes: (input.notes || "").slice(0, 1000) || null, createdBy: ctx.userId ?? null,
        recurring, recurrenceDay: recDay, recurrenceAmountCents: recAmount != null ? BigInt(recAmount) : null,
        recurrenceUntil: input.recurrenceUntil ? new Date(input.recurrenceUntil + "T00:00:00Z") : null,
        recurrenceLast: recurring ? firstOfMonth : null,
        installments: { create: insts.map((i) => ({ organizationId: orgId, number: i.number, dueDate: i.dueDate, amountCents: BigInt(i.amountCents), barcode: i.barcode })) },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    }));
  }

  /** Lista parcelas (com a conta) por status derivado + período de vencimento. */
  async list(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const where: any = {};
    if (opts.status === "pago") where.status = "pago";
    else if (opts.status === "vencido") { where.status = "a_pagar"; where.dueDate = { lt: today }; }
    else if (opts.status === "a_vencer") { where.status = "a_pagar"; where.dueDate = { gte: today }; }
    else if (opts.status === "a_pagar") where.status = "a_pagar";
    if (opts.from || opts.to) where.dueDate = { ...(where.dueDate ?? {}), ...(opts.from ? { gte: new Date(opts.from + "T00:00:00Z") } : {}), ...(opts.to ? { lte: new Date(opts.to + "T23:59:59Z") } : {}) };
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.findMany({
      where, orderBy: [{ dueDate: "asc" }], take: 1000,
      include: { payable: { select: { id: true, supplier: true, description: true, category: true, docType: true, docNumber: true } } },
    }));
    const search = (opts.search || "").trim().toLowerCase();
    const items = rows
      .filter((r: any) => !search || `${r.payable?.supplier ?? ""} ${r.payable?.description ?? ""} ${r.payable?.docNumber ?? ""}`.toLowerCase().includes(search))
      .map((r: any) => ({ ...r, amountCents: Number(r.amountCents), paidCents: r.paidCents != null ? Number(r.paidCents) : null, overdue: r.status === "a_pagar" && new Date(r.dueDate) < today }));
    return { items };
  }

  async getById(ctx: RequestContext, payableId: string) {
    this.requireOrg(ctx);
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payable.findFirst({
      where: { id: payableId }, include: { installments: { orderBy: { number: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } },
    }));
    if (!p) throw new AppError(ErrorCode.NotFound, "Conta não encontrada", 404);
    return p;
  }

  async remove(ctx: RequestContext, payableId: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payable.deleteMany({ where: { id: payableId } }));
    return { ok: true };
  }

  // ---------------- baixa / parcela ----------------
  async payInstallment(ctx: RequestContext, installmentId: string, input: { paidCents?: number; paidAt?: string; paymentMethod?: string; notes?: string; proof?: string; proofName?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const inst = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.findFirst({ where: { id: installmentId } }));
    if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela não encontrada", 404);
    let proofUrl: string | null = inst.proofUrl;
    if (input.proof) {
      const { contentType, buf } = this.parseDataUrl(input.proof);
      const { key } = await this.storage.putPrivate({ keyPrefix: `payables/${orgId}/proofs`, contentType, body: buf, originalName: input.proofName });
      proofUrl = key;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableAttachment.create({ data: { organizationId: orgId, payableId: inst.payableId, installmentId: inst.id, kind: "comprovante", url: key, filename: input.proofName ?? null } }));
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.update({
      where: { id: installmentId },
      data: {
        status: "pago",
        paidCents: BigInt(Math.max(0, Math.round(input.paidCents ?? Number(inst.amountCents)))),
        paidAt: input.paidAt ? new Date(input.paidAt + "T00:00:00Z") : new Date(),
        paymentMethod: (input.paymentMethod || "").slice(0, 40) || null,
        notes: input.notes != null ? (input.notes || "").slice(0, 1000) || null : inst.notes,
        proofUrl,
      },
    }));
  }

  async setInstallmentStatus(ctx: RequestContext, installmentId: string, status: "a_pagar" | "cancelado") {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.update({
      where: { id: installmentId }, data: status === "a_pagar" ? { status: "a_pagar", paidAt: null, paidCents: null, paymentMethod: null } : { status: "cancelado" },
    }));
  }

  // ---------------- anexos ----------------
  async addAttachment(ctx: RequestContext, input: { payableId?: string; installmentId?: string; kind?: string; data: string; filename?: string; extracted?: any }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.payableId && !input.installmentId) throw new AppError(ErrorCode.ValidationFailed, "Informe a conta ou a parcela", 400);
    const { contentType, buf } = this.parseDataUrl(input.data);
    const kind = ["boleto", "danfe", "nfe_xml", "comprovante", "outro"].includes(input.kind ?? "") ? input.kind! : "outro";
    const { key } = await this.storage.putPrivate({ keyPrefix: `payables/${orgId}/${kind}`, contentType, body: buf, originalName: input.filename });
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableAttachment.create({
      data: { organizationId: orgId, payableId: input.payableId ?? null, installmentId: input.installmentId ?? null, kind, url: key, filename: input.filename ?? null, extracted: input.extracted ?? {} },
    }));
  }

  /** Stream do anexo (privado) — só admin da org. */
  async attachmentFile(ctx: RequestContext, id: string): Promise<{ body: Buffer; contentType: string; filename: string }> {
    this.requireOrg(ctx);
    const att = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableAttachment.findFirst({ where: { id } }));
    if (!att) throw new AppError(ErrorCode.NotFound, "Anexo não encontrado", 404);
    const f = await this.storage.getPrivate(att.url);
    return { body: f.body, contentType: f.contentType, filename: att.filename ?? "anexo" };
  }

  // ---------------- relatórios ----------------
  /** Resumo: a vencer / vencido / a pagar (total aberto) / pago no período + por categoria. */
  async summary(ctx: RequestContext, opts: { from?: string; to?: string }) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = opts.from ? new Date(opts.from + "T00:00:00Z") : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = opts.to ? new Date(opts.to + "T23:59:59Z") : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59));
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const open = await tx.payableInstallment.findMany({ where: { status: "a_pagar" }, select: { dueDate: true, amountCents: true, payable: { select: { category: true } } } });
      let aVencerC = 0, aVencerV = 0, vencidoC = 0, vencidoV = 0;
      const cat = new Map<string, number>();
      for (const i of open) {
        const v = Number(i.amountCents);
        if (new Date(i.dueDate) < today) { vencidoC++; vencidoV += v; } else { aVencerC++; aVencerV += v; }
        const c = (i.payable?.category || "sem categoria").toLowerCase();
        cat.set(c, (cat.get(c) ?? 0) + v);
      }
      const pagos = await tx.payableInstallment.findMany({ where: { status: "pago", paidAt: { gte: start, lte: end } }, select: { paidCents: true, amountCents: true } });
      const pagoV = pagos.reduce((s, p) => s + Number(p.paidCents ?? p.amountCents), 0);
      return {
        period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
        aVencer: { count: aVencerC, cents: aVencerV },
        vencido: { count: vencidoC, cents: vencidoV },
        aPagarTotal: { count: aVencerC + vencidoC, cents: aVencerV + vencidoV },
        pagoPeriodo: { count: pagos.length, cents: pagoV },
        porCategoria: [...cat.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
      };
    });
  }

  /** Export CSV da lista (mesmos filtros da tela). */
  async exportCsv(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const { items } = await this.list(ctx, opts);
    const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    const rows: string[] = ["Fornecedor;Descricao;Categoria;Documento;Parcela;Vencimento;Valor;Status;Pago em;Meio;Valor pago"];
    for (const it of items as any[]) {
      const st = it.status === "pago" ? "pago" : it.overdue ? "vencido" : "a_pagar";
      rows.push([
        it.payable?.supplier ?? "", it.payable?.description ?? "", it.payable?.category ?? "", it.payable?.docNumber ?? "",
        it.number, String(it.dueDate).slice(0, 10), money(Number(it.amountCents)), st,
        it.paidAt ? String(it.paidAt).slice(0, 10) : "", it.paymentMethod ?? "", it.paidCents != null ? money(Number(it.paidCents)) : "",
      ].map((c) => String(c).replace(/;/g, ",")).join(";"));
    }
    const buffer = Buffer.from("﻿" + rows.join("\r\n"), "utf8");
    return { buffer, filename: `contas-a-pagar-${opts.status ?? "todas"}-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  /** Relatório PDF (resumo + lista) das contas a pagar, filtrado por status/período. */
  async reportPdf(ctx: RequestContext, opts: { status?: string; from?: string; to?: string; search?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const [{ items }, sum, org] = await Promise.all([
      this.list(ctx, opts),
      this.summary(ctx, { from: opts.from, to: opts.to }),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true } })).catch(() => null),
    ]);
    const money = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      const M = 40, W = pdf.page.width, right = W - M;
      pdf.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(org?.name ?? "Empresa", M, 40);
      pdf.font("Helvetica").fontSize(11).fillColor("#555").text("Relatório de contas a pagar", M);
      const statusLbl: any = { a_pagar: "A pagar", a_vencer: "A vencer", vencido: "Vencido", pago: "Pago" };
      pdf.fontSize(9).text(`Filtro: ${statusLbl[opts.status ?? ""] ?? "todas"}${opts.from || opts.to ? ` · ${opts.from ?? ""} a ${opts.to ?? ""}` : ""} · emitido em ${new Date().toLocaleString("pt-BR")}`);
      pdf.moveDown(0.6); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Resumo");
      pdf.font("Helvetica").fontSize(10).fillColor("#333");
      pdf.text(`A vencer: ${sum.aVencer.count} · ${money(sum.aVencer.cents)}    |    Vencido: ${sum.vencido.count} · ${money(sum.vencido.cents)}`);
      pdf.text(`Total a pagar (aberto): ${sum.aPagarTotal.count} · ${money(sum.aPagarTotal.cents)}    |    Pago no período: ${sum.pagoPeriodo.count} · ${money(sum.pagoPeriodo.cents)}`);
      pdf.moveDown(0.6); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
      // tabela
      const cols = [{ t: "Fornecedor / descrição", w: 200 }, { t: "Venc.", w: 70 }, { t: "Valor", w: 90 }, { t: "Status", w: 70 }];
      const drawHead = () => { let cx = M; pdf.font("Helvetica-Bold").fontSize(9).fillColor("#111"); cols.forEach((c) => { pdf.text(c.t, cx, pdf.y, { width: c.w, lineBreak: false, continued: false }); cx += c.w; }); pdf.moveDown(0.3); };
      drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333");
      for (const it of items as any[]) {
        if (pdf.y > pdf.page.height - 60) { pdf.addPage(); drawHead(); pdf.font("Helvetica").fontSize(9).fillColor("#333"); }
        const st = it.status === "pago" ? "pago" : it.overdue ? "vencido" : "a pagar";
        const name = (it.payable?.supplier || it.payable?.description || "—").slice(0, 42);
        const y = pdf.y; let cx = M;
        pdf.text(name, cx, y, { width: cols[0]!.w, lineBreak: false }); cx += cols[0]!.w;
        pdf.text(new Date(it.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" }), cx, y, { width: cols[1]!.w, lineBreak: false }); cx += cols[1]!.w;
        pdf.text(money(Number(it.amountCents)), cx, y, { width: cols[2]!.w, lineBreak: false }); cx += cols[2]!.w;
        pdf.fillColor(st === "vencido" ? "#b00" : st === "pago" ? "#0a0" : "#333").text(st, cx, y, { width: cols[3]!.w, lineBreak: false }); pdf.fillColor("#333");
        pdf.moveDown(0.4);
      }
      pdf.end();
    });
    return { buffer, filename: `contas-a-pagar-${opts.status ?? "todas"}-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  // ---------------- leitura de boleto (linha digitável / código de barras) ----------------
  /** Extrai vencimento e valor do boleto bancário (47 díg linha digitável ou 44 díg barras). */
  parseBoleto(raw: string): { barcode: string | null; dueDate: string | null; amountCents: number | null } {
    const digits = (raw || "").replace(/\D/g, "");
    let fator = "", valor = "";
    if (digits.length === 47) { fator = digits.slice(33, 37); valor = digits.slice(37, 47); }       // linha digitável (banco)
    else if (digits.length === 44) { fator = digits.slice(5, 9); valor = digits.slice(9, 19); }      // código de barras (banco)
    else return { barcode: digits || null, dueDate: null, amountCents: null };                       // arrecadação/concessionária: só guarda
    const f = parseInt(fator, 10);
    let dueDate: string | null = null;
    if (f > 0) {
      // fator de vencimento FEBRABAN: dias desde 07/10/1997; com rollover (9999→1000).
      let d = new Date(Date.UTC(1997, 9, 7) + f * 86400000);
      while (d.getTime() < Date.now() - 120 * 86400000) d = new Date(d.getTime() + 9000 * 86400000); // ciclo pós-2025
      dueDate = d.toISOString().slice(0, 10);
    }
    const cents = /^\d+$/.test(valor) ? parseInt(valor, 10) : 0;
    return { barcode: digits, dueDate, amountCents: cents > 0 ? cents : null };
  }

  // ---------------- OCR/IA do comprovante (boleto/NF/comprovante) ----------------
  /**
   * Lê uma imagem (boleto, nota, comprovante) com a IA da empresa (visão) e extrai
   * os campos. Best-effort: se a empresa não tiver provedor com visão, devolve
   * { available:false } e a UI segue no preenchimento manual / leitura de boleto.
   */
  async ocrDocument(ctx: RequestContext, input: { data: string }): Promise<any> {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    this.parseDataUrl(input.data); // valida tamanho/formato
    const system = "Você extrai dados de documentos financeiros brasileiros (boleto bancário, nota fiscal/DANFE, comprovante de pagamento). Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem markdown.";
    const user = [
      "Extraia destes campos o que conseguir identificar na imagem e devolva em JSON:",
      '{ "supplier": string|null (fornecedor/favorecido/emitente), "description": string|null, "category": string|null (ex.: aluguel, energia, fornecedor, internet), "docNumber": string|null (nº NF ou documento), "dueDate": "YYYY-MM-DD"|null (vencimento), "amountCents": number|null (valor TOTAL em CENTAVOS, inteiro), "barcode": string|null (linha digitável só dígitos, se boleto) }',
      "Regras: valores em centavos (R$ 1.234,56 => 123456). Datas no formato ISO. Se não tiver certeza de um campo, use null. Não invente.",
    ].join("\n");
    const raw = await this.ai.completeVision(orgId, system, user, input.data, 600).catch(() => null);
    if (!raw) return { available: false, message: "Sem IA com visão configurada para a empresa." };
    const parsed = this.parseJsonLoose(raw);
    if (!parsed) return { available: true, parsed: null, message: "A IA não retornou um JSON válido." };
    const out: any = {
      supplier: typeof parsed.supplier === "string" ? parsed.supplier.slice(0, 200) : null,
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 400) : null,
      category: typeof parsed.category === "string" ? parsed.category.slice(0, 80) : null,
      docNumber: typeof parsed.docNumber === "string" ? parsed.docNumber.slice(0, 60) : (parsed.docNumber != null ? String(parsed.docNumber).slice(0, 60) : null),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.dueDate ?? "")) ? String(parsed.dueDate) : null,
      amountCents: Number.isFinite(Number(parsed.amountCents)) && Number(parsed.amountCents) > 0 ? Math.round(Number(parsed.amountCents)) : null,
      barcode: typeof parsed.barcode === "string" ? parsed.barcode.replace(/\D/g, "").slice(0, 48) || null : null,
    };
    // se veio linha digitável, reforça vencimento/valor pela leitura determinística do boleto
    if (out.barcode && out.barcode.length >= 44) {
      const b = this.parseBoleto(out.barcode);
      if (b.dueDate) out.dueDate = b.dueDate;
      if (b.amountCents) out.amountCents = b.amountCents;
    }
    return { available: true, parsed: out };
  }

  /** Extrai um objeto JSON de um texto da IA (tolerante a cercas ```json e ruído). */
  private parseJsonLoose(s: string): any | null {
    if (!s) return null;
    let t = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    try { return JSON.parse(t); } catch { return null; }
  }

  // ---------------- carga de DANFE (XML da NF-e) ----------------
  /** Importa o XML da NF-e → cria a conta (doc_type danfe) + parcelas das duplicatas. */
  async importNfe(ctx: RequestContext, xml: string) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!xml || xml.length < 50) throw new AppError(ErrorCode.ValidationFailed, "XML inválido", 400);
    let j: any;
    try { j = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, attributeNamePrefix: "@_" }).parse(xml); } catch { throw new AppError(ErrorCode.ValidationFailed, "Não consegui ler o XML", 400); }
    const inf = j?.nfeProc?.NFe?.infNFe ?? j?.NFe?.infNFe ?? j?.infNFe;
    if (!inf) throw new AppError(ErrorCode.ValidationFailed, "XML não parece uma NF-e", 400);
    const emit = inf.emit ?? {}; const ide = inf.ide ?? {}; const total = inf.total?.ICMSTot ?? {};
    const chave = String(inf["@_Id"] ?? "").replace(/\D/g, "").slice(-44) || null;
    const vNF = Math.round((Number(total.vNF) || 0) * 100);
    const dhEmi = String(ide.dhEmi ?? ide.dEmi ?? "").slice(0, 10) || null;
    // duplicatas (cobrança): pode ser objeto único ou array
    const dupRaw = inf.cobr?.dup;
    const dups: any[] = Array.isArray(dupRaw) ? dupRaw : dupRaw ? [dupRaw] : [];
    let insts = dups
      .map((d: any, i: number) => ({ number: i + 1, dueDate: String(d.dVenc ?? "").slice(0, 10), amountCents: Math.round((Number(d.vDup) || 0) * 100) }))
      .filter((d) => d.dueDate && d.amountCents > 0);
    if (!insts.length) {
      // sem duplicatas: 1 parcela com o total, vencendo na emissão (operador ajusta)
      insts = [{ number: 1, dueDate: dhEmi ?? new Date().toISOString().slice(0, 10), amountCents: vNF || 0 }];
    }
    if (insts.reduce((s, i) => s + i.amountCents, 0) === 0) throw new AppError(ErrorCode.ValidationFailed, "NF-e sem valor identificável", 400);
    const payable = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payable.create({
      data: {
        organizationId: orgId, supplier: String(emit.xNome ?? emit.xFant ?? "").slice(0, 200) || null,
        description: `NF-e ${ide.nNF ?? ""}`.trim(), docType: "danfe", docNumber: String(ide.nNF ?? "").slice(0, 60) || null,
        nfeKey: chave, totalCents: BigInt(insts.reduce((s, i) => s + i.amountCents, 0)),
        issueDate: dhEmi ? new Date(dhEmi + "T00:00:00Z") : null, createdBy: ctx.userId ?? null,
        installments: { create: insts.map((i) => ({ organizationId: orgId, number: i.number, dueDate: new Date(i.dueDate + "T00:00:00Z"), amountCents: BigInt(i.amountCents) })) },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    }));
    // guarda o XML como anexo
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const { key } = await this.storage.putPrivate({ keyPrefix: `payables/${orgId}/nfe_xml`, contentType: "application/xml", body: Buffer.from(xml, "utf8"), originalName: `${chave ?? "nfe"}.xml` });
      await tx.payableAttachment.create({ data: { organizationId: orgId, payableId: payable.id, kind: "nfe_xml", url: key, filename: `${chave ?? "nfe"}.xml`, extracted: { emit: emit.xNome ?? null, vNF, chave, nNF: ide.nNF ?? null } } });
    });
    return payable;
  }

  // ---------------- destinatários (notificação — usado na fase 4) ----------------
  async listRecipients(ctx: RequestContext) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableNotifyRecipient.findMany({ orderBy: { createdAt: "asc" } }));
  }
  async upsertRecipient(ctx: RequestContext, input: { id?: string; name: string; email?: string; whatsapp?: string; events?: string[]; active?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const data = {
      name: (input.name || "").slice(0, 120), email: (input.email || "").slice(0, 200) || null, whatsapp: (input.whatsapp || "").replace(/\D/g, "").slice(0, 20) || null,
      events: (input.events && input.events.length ? input.events : ["a_vencer", "vencido"]).filter((e) => ["a_vencer", "vencido", "pago"].includes(e)),
      active: input.active ?? true,
    };
    if (!data.name) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome", 400);
    if (input.id) return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableNotifyRecipient.update({ where: { id: input.id }, data }));
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableNotifyRecipient.create({ data: { organizationId: orgId, ...data } }));
  }
  async removeRecipient(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableNotifyRecipient.deleteMany({ where: { id } }));
    return { ok: true };
  }
}
