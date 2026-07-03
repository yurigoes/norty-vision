import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import PDFDocument from "pdfkit";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { NotificationService } from "../notifications/notification.service";
import { ProductionService } from "../production/production.service";
import type { RequestContext } from "../auth/session.middleware";

interface QuoteItemInput { description: string; qty: number; unitPriceCents: number }
interface UpsertQuoteInput {
  customerId?: string | null;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  storeId?: string | null;
  validUntil?: string | null;
  discountCents?: number;
  notes?: string | null;
  items: QuoteItemInput[];
}

function genShortCode(): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return `ORC-${s}`;
}
function brl(cents: number): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger("Quotes");
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly production: ProductionService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403);
  }

  private computeTotals(items: QuoteItemInput[], discountCents: number) {
    const lines = items.map((it) => ({ ...it, qty: Math.max(1, Math.trunc(it.qty)), lineTotalCents: Math.max(0, Math.round(it.unitPriceCents)) * Math.max(1, Math.trunc(it.qty)) }));
    const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
    const total = Math.max(0, subtotal - Math.max(0, discountCents));
    return { lines, subtotal, total };
  }

  async list(ctx: RequestContext, opts?: { status?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.quote.findMany({ where: { ...(opts?.status ? { status: opts.status } : {}) }, orderBy: { createdAt: "desc" }, include: { items: true }, take: 500 }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const q = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.findFirst({ where: { id }, include: { items: true } }));
    if (!q) throw new AppError(ErrorCode.NotFound, "Orçamento não encontrado", 404);
    return q;
  }

  async create(ctx: RequestContext, input: UpsertQuoteInput) {
    this.requireOrg(ctx);
    if (!input.items?.length) throw new AppError(ErrorCode.ValidationFailed, "Orçamento sem itens", 400);
    const { lines, total } = this.computeTotals(input.items, input.discountCents ?? 0);
    let shortCode = genShortCode();
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      for (let i = 0; i < 5; i++) { if (!(await tx.quote.findFirst({ where: { shortCode }, select: { id: true } }))) break; shortCode = genShortCode(); }
      const q = await tx.quote.create({
        data: {
          organizationId: ctx.orgId!, storeId: input.storeId ?? null, customerId: input.customerId ?? null,
          shortCode, contactName: input.contactName, contactPhone: input.contactPhone ?? null, contactEmail: input.contactEmail ?? null,
          status: "draft", notes: input.notes ?? null, validUntil: input.validUntil ? new Date(input.validUntil) : null,
          discountCents: Math.max(0, input.discountCents ?? 0), totalCents: BigInt(total),
          sellerUserId: ctx.userId ?? null, createdByUserId: ctx.userId ?? null,
          items: { create: lines.map((l) => ({ organizationId: ctx.orgId!, description: l.description, qty: l.qty, unitPriceCents: BigInt(Math.round(l.unitPriceCents)), lineTotalCents: BigInt(l.lineTotalCents) })) },
        },
        include: { items: true },
      });
      return q;
    });
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertQuoteInput>) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const cur = await tx.quote.findFirst({ where: { id }, include: { items: true } });
      if (!cur) throw new AppError(ErrorCode.NotFound, "Orçamento não encontrado", 404);
      const data: any = { pdfUrl: null }; // qualquer edição invalida o PDF gerado
      for (const k of ["contactName", "contactPhone", "contactEmail", "customerId", "storeId", "notes"] as const) {
        if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
      }
      if (input.validUntil !== undefined) data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
      if (input.items) {
        const { lines, total } = this.computeTotals(input.items, input.discountCents ?? cur.discountCents);
        data.discountCents = Math.max(0, input.discountCents ?? cur.discountCents);
        data.totalCents = BigInt(total);
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        await tx.quoteItem.createMany({ data: lines.map((l) => ({ organizationId: cur.organizationId, quoteId: id, description: l.description, qty: l.qty, unitPriceCents: BigInt(Math.round(l.unitPriceCents)), lineTotalCents: BigInt(l.lineTotalCents) })) });
      } else if (input.discountCents !== undefined) {
        const subtotal = cur.items.reduce((s, it) => s + Number(it.lineTotalCents), 0);
        data.discountCents = Math.max(0, input.discountCents);
        data.totalCents = BigInt(Math.max(0, subtotal - data.discountCents));
      }
      await tx.quote.update({ where: { id }, data });
      return tx.quote.findFirst({ where: { id }, include: { items: true } });
    });
  }

  async setStatus(ctx: RequestContext, id: string, status: string) {
    this.requireOrg(ctx);
    if (!["draft", "sent", "accepted", "rejected", "converted", "expired"].includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.update({ where: { id }, data: { status } }));
  }

  async remove(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.deleteMany({ where: { id } }));
    return { ok: true };
  }

  // ---------- PDF ----------
  private async branding(orgId: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true, document: true, contactPhone: true, contactEmail: true } }),
    );
  }

  /** Gera o PDF do orçamento (pdfkit, sem Chromium). */
  async buildPdfBuffer(q: any, brand: { name: string; logoUrl: string | null; primaryColor: string | null; document: string | null; contactPhone: string | null; contactEmail: string | null }): Promise<Buffer> {
    const color = brand.primaryColor && /^#?[0-9a-fA-F]{6}$/.test(brand.primaryColor) ? (brand.primaryColor.startsWith("#") ? brand.primaryColor : `#${brand.primaryColor}`) : "#7c3aed";
    // tenta baixar o logo (png/jpg) — svg é ignorado
    let logoBuf: Buffer | null = null;
    if (brand.logoUrl) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(brand.logoUrl, { signal: ctrl.signal }); clearTimeout(t);
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (r.ok && (ct.includes("png") || ct.includes("jpeg") || ct.includes("jpg"))) logoBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignora */ }
    }
    return await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const W = doc.page.width, M = 48, right = W - M;

      // cabeçalho
      if (logoBuf) { try { doc.image(logoBuf, M, 40, { fit: [120, 48] }); } catch { /* */ } }
      doc.fillColor(color).fontSize(20).font("Helvetica-Bold").text("ORÇAMENTO", M, 44, { align: "right" });
      doc.fillColor("#555").fontSize(10).font("Helvetica").text(`Nº ${q.shortCode ?? q.id.slice(0, 8)}`, { align: "right" });
      doc.text(new Date(q.createdAt).toLocaleDateString("pt-BR"), { align: "right" });
      doc.moveDown(2);
      doc.moveTo(M, 100).lineTo(right, 100).strokeColor(color).lineWidth(2).stroke();

      // empresa + cliente
      let y = 116;
      doc.fillColor("#111").fontSize(11).font("Helvetica-Bold").text(brand.name, M, y);
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      if (brand.document) doc.text(`CNPJ/CPF: ${brand.document}`);
      if (brand.contactPhone) doc.text(`Tel.: ${brand.contactPhone}`);
      if (brand.contactEmail) doc.text(brand.contactEmail);

      doc.fontSize(11).font("Helvetica-Bold").fillColor("#111").text("Cliente", right - 220, y, { width: 220 });
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      doc.text(q.contactName, right - 220, undefined as any, { width: 220 });
      if (q.contactPhone) doc.text(`Tel.: ${q.contactPhone}`, right - 220, undefined as any, { width: 220 });
      if (q.contactEmail) doc.text(q.contactEmail, right - 220, undefined as any, { width: 220 });

      // tabela de itens
      y = 190;
      doc.rect(M, y, right - M, 22).fill(color);
      doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
      doc.text("Descrição", M + 8, y + 6, { width: right - M - 230 });
      doc.text("Qtd", right - 215, y + 6, { width: 40, align: "right" });
      doc.text("Unitário", right - 165, y + 6, { width: 70, align: "right" });
      doc.text("Total", right - 90, y + 6, { width: 82, align: "right" });
      y += 22;
      doc.font("Helvetica").fontSize(9).fillColor("#111");
      for (const it of q.items ?? []) {
        const h = Math.max(18, doc.heightOfString(it.description, { width: right - M - 230 }) + 8);
        if (y + h > doc.page.height - 120) { doc.addPage(); y = 60; }
        doc.fillColor("#111").text(it.description, M + 8, y + 4, { width: right - M - 230 });
        doc.text(String(it.qty), right - 215, y + 4, { width: 40, align: "right" });
        doc.text(brl(Number(it.unitPriceCents)), right - 165, y + 4, { width: 70, align: "right" });
        doc.text(brl(Number(it.lineTotalCents)), right - 90, y + 4, { width: 82, align: "right" });
        doc.moveTo(M, y + h).lineTo(right, y + h).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
        y += h;
      }

      // totais
      y += 10;
      const subtotal = (q.items ?? []).reduce((s: number, it: any) => s + Number(it.lineTotalCents), 0);
      const drawTotal = (label: string, val: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(bold ? color : "#555");
        doc.text(label, right - 240, y, { width: 140, align: "right" });
        doc.text(val, right - 90, y, { width: 82, align: "right" });
        y += bold ? 20 : 16;
      };
      drawTotal("Subtotal", brl(subtotal));
      if (Number(q.discountCents) > 0) drawTotal("Desconto", `- ${brl(Number(q.discountCents))}`);
      drawTotal("TOTAL", brl(Number(q.totalCents)), true);

      // observações / validade
      y += 8;
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      if (q.validUntil) doc.text(`Válido até ${new Date(q.validUntil).toLocaleDateString("pt-BR")}.`, M, y, { width: right - M });
      if (q.notes) doc.moveDown(0.5).text(q.notes, M, undefined as any, { width: right - M });
      doc.moveDown(1).fillColor("#999").fontSize(8).text(`Gerado por ${brand.name} em ${new Date().toLocaleString("pt-BR")}.`, M, undefined as any, { width: right - M });
      doc.end();
    });
  }

  /** Gera (se preciso) e devolve a URL pública do PDF do orçamento. */
  async ensurePdf(ctx: RequestContext, id: string): Promise<{ url: string; quote: any }> {
    const q = await this.getById(ctx, id);
    const brand = await this.branding(q.organizationId);
    const buf = await this.buildPdfBuffer(q, {
      name: brand?.name ?? "Empresa", logoUrl: brand?.logoUrl ?? null, primaryColor: brand?.primaryColor ?? null,
      document: brand?.document ?? null, contactPhone: brand?.contactPhone ?? null, contactEmail: brand?.contactEmail ?? null,
    });
    const { url } = await this.storage.putPublic({ keyPrefix: `quotes/${q.organizationId}`, contentType: "application/pdf", body: buf, originalName: `${q.shortCode ?? "orcamento"}.pdf` });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.update({ where: { id }, data: { pdfUrl: url } }));
    return { url, quote: q };
  }

  /** PDF como buffer pra download direto no navegador. */
  async pdfBuffer(ctx: RequestContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const q = await this.getById(ctx, id);
    const brand = await this.branding(q.organizationId);
    const buffer = await this.buildPdfBuffer(q, {
      name: brand?.name ?? "Empresa", logoUrl: brand?.logoUrl ?? null, primaryColor: brand?.primaryColor ?? null,
      document: brand?.document ?? null, contactPhone: brand?.contactPhone ?? null, contactEmail: brand?.contactEmail ?? null,
    });
    return { buffer, filename: `${q.shortCode ?? "orcamento"}.pdf` };
  }

  /** Envia o orçamento por WhatsApp (PDF anexo) e/ou e-mail (HTML branded + link do PDF). */
  async send(ctx: RequestContext, id: string, channel: "whatsapp" | "email" | "both") {
    this.requireOrg(ctx);
    const { url, quote } = await this.ensurePdf(ctx, id);
    const brand = await this.branding(quote.organizationId);
    const color = brand?.primaryColor && /^#?[0-9a-fA-F]{6}$/.test(brand.primaryColor) ? (brand.primaryColor.startsWith("#") ? brand.primaryColor : `#${brand.primaryColor}`) : "#7c3aed";
    const first = (quote.contactName || "Cliente").split(" ")[0];
    const total = brl(Number(quote.totalCents));
    const text = `Olá, ${first}! 😊\n\nSegue seu orçamento da ${brand?.name ?? "nossa loja"}:\n\n💰 Total: ${total}\n${quote.validUntil ? `🗓️ Válido até ${new Date(quote.validUntil).toLocaleDateString("pt-BR")}\n` : ""}\nO PDF está anexado. Qualquer dúvida, é só responder por aqui!`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
      <div style="background:${color};color:#fff;padding:16px 20px;font-size:18px;font-weight:700">${esc(brand?.name ?? "Orçamento")}</div>
      <div style="padding:20px;color:#333">
        <p>Olá, <b>${esc(first)}</b>!</p>
        <p>Segue o seu orçamento <b>${esc(quote.shortCode ?? "")}</b>.</p>
        <p style="font-size:22px;font-weight:700;color:${color}">Total: ${total}</p>
        ${quote.validUntil ? `<p style="color:#666">Válido até ${new Date(quote.validUntil).toLocaleDateString("pt-BR")}.</p>` : ""}
        <p><a href="${esc(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Baixar PDF do orçamento</a></p>
        <p style="color:#999;font-size:12px;margin-top:24px">Enviado por ${esc(brand?.name ?? "")}.</p>
      </div>
    </div>`;

    const wantWa = channel === "whatsapp" || channel === "both";
    const wantEmail = channel === "email" || channel === "both";
    const res = await this.notifications.notify({
      organizationId: quote.organizationId, storeId: quote.storeId ?? quote.organizationId,
      customerId: quote.customerId ?? null,
      whatsappPhone: wantWa ? (quote.contactPhone ?? null) : null,
      email: wantEmail ? (quote.contactEmail ?? null) : null,
      subject: `Orçamento ${quote.shortCode ?? ""} — ${brand?.name ?? ""}`.trim(),
      text, html,
      templateCode: "quote_send",
      media: { url, fileName: `${quote.shortCode ?? "orcamento"}.pdf`, mediatype: "document" },
    }).catch((e) => { this.logger.warn(`envio orçamento falhou: ${e?.message}`); return { whatsapp: false, email: false }; });

    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.update({ where: { id }, data: { status: quote.status === "draft" ? "sent" : quote.status } }));
    return { ok: true, pdfUrl: url, sent: res };
  }

  /** Converte um orçamento aceito em pedido de produção (aplica a política de sinal da gráfica). */
  async convertToProduction(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    const q = await this.getById(ctx, id);
    if (q.status === "converted") throw new AppError(ErrorCode.Conflict, "Orçamento já virou pedido", 409);
    if (!q.items?.length) throw new AppError(ErrorCode.ValidationFailed, "Orçamento sem itens", 400);
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId: q.organizationId }, select: { graficaLeadDays: true, graficaDownPaymentPct: true } }),
    ).catch(() => null);
    const leadDays = Math.max(0, cfg?.graficaLeadDays ?? 7);
    const pct = Math.min(100, Math.max(0, cfg?.graficaDownPaymentPct ?? 50));
    const total = Number(q.totalCents);
    const downPaymentCents = Math.round(total * pct / 100);
    const dueDate = new Date(Date.now() + leadDays * 86400_000).toISOString().slice(0, 10);
    const order = await this.production.create(ctx, {
      customerId: q.customerId ?? null, contactName: q.contactName, contactPhone: q.contactPhone ?? null, contactEmail: q.contactEmail ?? null,
      storeId: q.storeId ?? null, dueDate, downPaymentCents,
      items: q.items.map((it: any) => ({ description: it.description, qty: it.qty, unitPriceCents: Number(it.unitPriceCents) })),
      notes: `Gerado do orçamento ${q.shortCode ?? id}`,
    });
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.quote.update({ where: { id }, data: { status: "converted" } }));
    return { ok: true, order };
  }
}
