import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import type { RequestContext } from "../auth/session.middleware";

// dias após o vencimento para suspender a empresa inadimplente
const GRACE_DAYS = 7;

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function competenceLabel(c: string): string {
  const [y, m] = c.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mi = Math.max(1, Math.min(12, parseInt(m ?? "1", 10))) - 1;
  return `${months[mi]}/${y}`;
}

const CreateSchema = z.object({
  organizationId: z.string().uuid(),
  competence: z.string().regex(/^\d{4}-\d{2}$/, "Use AAAA-MM"),
  amountCents: z.number().int().min(0),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["pending", "paid", "canceled"]).optional(),
  paymentMethod: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

@Injectable()
export class SubscriptionInvoicesService {
  private readonly logger = new Logger("SubscriptionInvoices");
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly integrations: IntegrationsService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireMaster(ctx: RequestContext) { if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403); }

  /** Mensalidades da empresa logada (admin da empresa). */
  async listMine(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.subscriptionInvoice.findMany({ where: ctx.orgId ? { organizationId: ctx.orgId } : {}, orderBy: { competence: "desc" }, take: 120 }),
    );
    return rows.map((r) => ({ ...r, amountCents: String(r.amountCents) }));
  }

  /** Todas as mensalidades (master) com dados da empresa. */
  async listAll(ctx: RequestContext, opts?: { status?: string }) {
    this.requireMaster(ctx);
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.findMany({
        where: { ...(opts?.status ? { status: opts.status } : {}) },
        orderBy: [{ status: "asc" }, { competence: "desc" }],
        take: 500,
      }),
    );
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, slug: true, document: true, contactEmail: true, planCode: true } }),
    );
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return rows.map((r) => ({ ...r, amountCents: String(r.amountCents), organization: byId.get(r.organizationId) ?? null }));
  }

  async create(ctx: RequestContext, body: unknown) {
    this.requireMaster(ctx);
    const input = CreateSchema.parse(body);
    const inv = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.create({
        data: {
          organizationId: input.organizationId,
          competence: input.competence,
          amountCents: BigInt(input.amountCents),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          status: input.status ?? "pending",
          paidAt: input.status === "paid" ? new Date() : null,
          paymentMethod: input.paymentMethod ?? null,
          notes: input.notes ?? null,
        },
      }),
    );
    return { ...inv, amountCents: String(inv.amountCents) };
  }

  async markPaid(ctx: RequestContext, id: string, body: { paymentMethod?: string | null; paidAt?: string | null }) {
    this.requireMaster(ctx);
    const inv = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.update({
        where: { id },
        data: { status: "paid", paidAt: body?.paidAt ? new Date(body.paidAt) : new Date(), paymentMethod: body?.paymentMethod ?? undefined },
      }),
    );
    await this.reactivateIfClear(inv.organizationId);
    return { ...inv, amountCents: String(inv.amountCents) };
  }

  /** Empresa paga a mensalidade via Mercado Pago da plataforma (Pix/cartão). */
  async startPayment(ctx: RequestContext, id: string, method: "pix" | "card") {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const inv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.subscriptionInvoice.findFirst({ where: { id, organizationId: ctx.orgId! } }));
    if (!inv) throw new AppError(ErrorCode.NotFound, "Mensalidade não encontrada", 404);
    if (inv.status === "paid") throw new AppError(ErrorCode.Conflict, "Mensalidade já paga", 409);
    if (Number(inv.amountCents) <= 0) throw new AppError(ErrorCode.ValidationFailed, "Mensalidade sem valor", 400);

    const mp = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "mercadopago" });
    if (!mp || mp.status !== "active" || !mp.apiToken) throw new AppError(ErrorCode.Internal, "Mercado Pago não está configurado pelo dono do sistema", 500);
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findUnique({ where: { id: ctx.orgId! }, select: { name: true, document: true, contactEmail: true } }));
    if (!org) throw new AppError(ErrorCode.NotFound, "Org não encontrada", 404);
    if (!org.contactEmail) throw new AppError(ErrorCode.ValidationFailed, "Cadastre um e-mail de contato na empresa antes", 400);

    const adapter = new MercadoPagoOrgAdapter(mp.apiToken);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const notificationUrl = `https://${domain}/api/subscriptions/webhooks/mercadopago`;
    const extRef = `inv:${inv.id}`;
    const amountCents = Number(inv.amountCents);
    const label = `Mensalidade ${competenceLabel(inv.competence)} — ${org.name}`;

    if (method === "pix") {
      const r = await adapter.createPixPayment({ amountCents, description: label, externalReference: extRef, payerEmail: org.contactEmail, payerName: org.name, payerDocument: org.document ?? "", notificationUrl });
      if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha ao gerar Pix: ${r.error}`, 500);
      const qr = r.body?.point_of_interaction?.transaction_data;
      return { method: "pix" as const, amountCents, qrCode: qr?.qr_code ?? null, qrCodeBase64: qr?.qr_code_base64 ?? null, ticketUrl: qr?.ticket_url ?? null };
    }
    const r = await adapter.createCheckoutPreference({ amountCents, title: label, externalReference: extRef, payerEmail: org.contactEmail, backUrl: `https://${domain}/app/billing?status=back`, notificationUrl });
    if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha no checkout cartão: ${r.error}`, 500);
    return { method: "card" as const, amountCents, initPoint: r.body?.init_point ?? null };
  }

  /** Baixa automática pelo webhook do MP (external_reference = inv:<id>). */
  async markPaidByWebhook(id: string, method?: string | null) {
    const inv = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.subscriptionInvoice.findUnique({ where: { id }, select: { status: true, organizationId: true } }));
    if (!inv || inv.status === "paid") return;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.update({ where: { id }, data: { status: "paid", paidAt: new Date(), paymentMethod: method ?? "mercadopago" } }),
    );
    await this.reactivateIfClear(inv.organizationId);
  }

  /** Reativa a empresa se foi suspensa por inadimplência e não há mais mensalidade vencida. */
  private async reactivateIfClear(organizationId: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { status: true } });
      if (org?.status !== "suspended") return;
      const overdue = await tx.subscriptionInvoice.count({ where: { organizationId, status: "pending", dueDate: { lt: new Date() } } });
      if (overdue === 0) await tx.organization.update({ where: { id: organizationId }, data: { status: "active" } });
    });
  }

  // ============================== COBRANÇA AUTOMÁTICA (cron) ==============================
  /**
   * Gera a mensalidade do mês (competência) pra cada empresa ativa com plano
   * pago. Idempotente: não duplica se já existe a competência da empresa.
   */
  async generateMonthlyInvoices(competence?: string): Promise<{ created: number; competence: string }> {
    const comp = competence ?? new Date().toISOString().slice(0, 7);
    const parts = comp.split("-");
    const y = parseInt(parts[0] ?? "0", 10);
    const m = parseInt(parts[1] ?? "1", 10);
    const dueDate = new Date(Date.UTC(y, (m - 1), 10)); // vence dia 10
    let created = 0;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const orgs = await tx.organization.findMany({ where: { deletedAt: null, status: "active" }, select: { id: true, planCode: true } });
      if (orgs.length === 0) return;
      const plans = await tx.plan.findMany({ select: { slug: true, priceCents: true } });
      const priceBySlug = new Map(plans.map((p) => [p.slug, p.priceCents]));
      for (const o of orgs) {
        const price = priceBySlug.get(o.planCode) ?? 0;
        if (!price || price <= 0) continue; // trial / sem preço → não cobra
        const exists = await tx.subscriptionInvoice.findFirst({ where: { organizationId: o.id, competence: comp }, select: { id: true } });
        if (exists) continue;
        await tx.subscriptionInvoice.create({
          data: { organizationId: o.id, competence: comp, amountCents: BigInt(price), status: "pending", dueDate },
        });
        created++;
      }
    });
    if (created) this.logger.log(`Mensalidades geradas (${comp}): ${created}`);
    return { created, competence: comp };
  }

  /**
   * Régua de cobrança das mensalidades: avisa as vencidas (no máx. 1x/dia) e
   * suspende a empresa após o período de carência.
   */
  async runDunning(): Promise<{ notified: number; suspended: number }> {
    let notified = 0, suspended = 0;
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const overdue = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.findMany({ where: { status: "pending", dueDate: { lt: now } }, take: 1000 }),
    );
    for (const inv of overdue) {
      try {
        const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.organization.findFirst({ where: { id: inv.organizationId }, select: { id: true, name: true, status: true, contactEmail: true, contactPhone: true, stores: { where: { deletedAt: null }, select: { id: true }, take: 1 } } }),
        );
        if (!org) continue;
        const storeId = org.stores[0]?.id ?? org.id;
        const dueDays = inv.dueDate ? Math.floor((startOfDay.getTime() - new Date(inv.dueDate).setHours(0, 0, 0, 0)) / 86400_000) : 0;

        // aviso 1x/dia
        const alreadyToday = inv.lastDunnedAt && new Date(inv.lastDunnedAt) >= startOfDay;
        if (!alreadyToday && (org.contactEmail || org.contactPhone)) {
          await this.notifications.notify({
            organizationId: org.id, storeId,
            whatsappPhone: org.contactPhone ?? null, email: org.contactEmail ?? null,
            subject: `Mensalidade em aberto — ${competenceLabel(inv.competence)}`,
            text: `Olá! Sua mensalidade de ${competenceLabel(inv.competence)} (${brl(Number(inv.amountCents))}) está em aberto${dueDays > 0 ? ` há ${dueDays} dia(s)` : ""}. Regularize para manter o acesso ativo.`,
            templateCode: "subscription_dunning",
          }).catch(() => undefined);
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { lastDunnedAt: new Date() } }));
          notified++;
        }

        // suspende após carência
        if (dueDays >= GRACE_DAYS && org.status === "active") {
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.update({ where: { id: org.id }, data: { status: "suspended" } }));
          suspended++;
          this.logger.warn(`Empresa suspensa por inadimplência: ${org.name} (${org.id})`);
        }
      } catch (e: any) {
        this.logger.error(`dunning falhou p/ invoice ${inv.id}: ${e?.message ?? e}`);
      }
    }
    return { notified, suspended };
  }

  async attachNf(ctx: RequestContext, id: string, url: string) {
    this.requireMaster(ctx);
    const inv = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionInvoice.update({ where: { id }, data: { nfUrl: url, nfUploadedAt: new Date() } }),
    );
    return { ...inv, amountCents: String(inv.amountCents) };
  }

  async remove(ctx: RequestContext, id: string) {
    this.requireMaster(ctx);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.subscriptionInvoice.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /** Recibo (PDF) de uma mensalidade paga — só o dono (empresa) ou master. */
  async receiptPdf(ctx: RequestContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const inv = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.subscriptionInvoice.findFirst({ where: { id } }),
    );
    if (!inv) throw new AppError(ErrorCode.NotFound, "Mensalidade não encontrada", 404);
    if (inv.status !== "paid") throw new AppError(ErrorCode.ValidationFailed, "Recibo disponível só para mensalidade paga", 400);
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: inv.organizationId }, select: { name: true, document: true } }),
    );
    const ps = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.platformSettings.findFirst());
    const buffer = await this.buildReceipt(inv, org, ps);
    return { buffer, filename: `recibo-${inv.competence}.pdf` };
  }

  private async buildReceipt(inv: any, org: any, ps: any): Promise<Buffer> {
    const color = ps?.primaryColor && /^#?[0-9a-fA-F]{6}$/.test(ps.primaryColor) ? (ps.primaryColor.startsWith("#") ? ps.primaryColor : `#${ps.primaryColor}`) : "#7c3aed";
    let logoBuf: Buffer | null = null;
    if (ps?.logoUrl) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(ps.logoUrl, { signal: ctrl.signal }); clearTimeout(t);
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (r.ok && (ct.includes("png") || ct.includes("jpeg") || ct.includes("jpg"))) logoBuf = Buffer.from(await r.arrayBuffer());
      } catch { /* ignora */ }
    }
    const provider = ps?.companyLegalName || ps?.productName || "yugochat";
    return await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const W = doc.page.width, M = 48, right = W - M;

      if (logoBuf) { try { doc.image(logoBuf, M, 40, { fit: [130, 50] }); } catch { /* */ } }
      doc.fillColor(color).fontSize(22).font("Helvetica-Bold").text("RECIBO", M, 46, { align: "right" });
      doc.fillColor("#555").fontSize(10).font("Helvetica").text(`Competência ${competenceLabel(inv.competence)}`, { align: "right" });
      doc.text(`Nº ${inv.id.slice(0, 8).toUpperCase()}`, { align: "right" });
      doc.moveTo(M, 104).lineTo(right, 104).strokeColor(color).lineWidth(2).stroke();

      let y = 124;
      doc.fillColor("#111").fontSize(11).font("Helvetica-Bold").text("Prestador", M, y);
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      doc.text(provider, M, undefined as any);
      if (ps?.companyDocument) doc.text(`CNPJ: ${ps.companyDocument}`);
      if (ps?.supportEmail) doc.text(ps.supportEmail);
      if (ps?.supportPhone) doc.text(ps.supportPhone);

      doc.fillColor("#111").fontSize(11).font("Helvetica-Bold").text("Pagador", right - 240, y, { width: 240 });
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      doc.text(org?.name ?? "Empresa", right - 240, undefined as any, { width: 240 });
      if (org?.document) doc.text(`CNPJ/CPF: ${org.document}`, right - 240, undefined as any, { width: 240 });

      y = 210;
      doc.rect(M, y, right - M, 64).fill("#f4f4f6");
      doc.fillColor("#111").fontSize(11).font("Helvetica").text("Recebemos a importância de", M + 16, y + 12);
      doc.fillColor(color).fontSize(24).font("Helvetica-Bold").text(brl(Number(inv.amountCents)), M + 16, y + 28);
      doc.fillColor("#555").fontSize(10).font("Helvetica").text(`Pago em ${inv.paidAt ? new Date(inv.paidAt).toLocaleDateString("pt-BR") : "-"}${inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}`, right - 250, y + 40, { width: 234, align: "right" });

      y += 96;
      doc.fillColor("#444").fontSize(10).font("Helvetica").text(
        `Referente à assinatura mensal do sistema (${competenceLabel(inv.competence)}).`,
        M, y, { width: right - M },
      );
      if (inv.notes) { doc.moveDown(0.5); doc.fillColor("#666").fontSize(9).text(inv.notes, M, undefined as any, { width: right - M }); }

      doc.fillColor("#999").fontSize(8).font("Helvetica").text(
        `Documento gerado eletronicamente por ${ps?.productName ?? "yugochat"}.`,
        M, doc.page.height - 70, { width: right - M, align: "center" },
      );
      doc.end();
    });
  }
}
