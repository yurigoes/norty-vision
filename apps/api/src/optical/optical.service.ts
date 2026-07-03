import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { SurveysService } from "../surveys/surveys.service";
import type { RequestContext } from "../auth/session.middleware";

interface CreateOrderInput {
  storeId?: string;
  customerId?: string | null;
  saleId?: string | null;
  doctorSupplierId?: string | null;
  labSupplierId?: string | null;
  prescription?: Record<string, unknown>;
  examAttachmentUrl?: string | null;
  customerPriceCents?: number | null;
  labCostCents?: number | null;
  notes?: string | null;
  sellerUserId?: string | null;
  productDescription?: string | null;
  productPhotoUrl?: string | null;
  frameProductId?: string | null;
  lensProductId?: string | null;
  osNumber?: string | null;
}

@Injectable()
export class OpticalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly surveys: SurveysService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireOrg(ctx: RequestContext): string {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId;
  }

  private async resolveStoreId(ctx: RequestContext, given?: string): Promise<string> {
    if (given) return given;
    if (ctx.storeId) return ctx.storeId;
    const stores = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findMany({
        where: { organizationId: ctx.orgId!, status: "active", deletedAt: null },
        select: { id: true },
        take: 2,
      }),
    );
    if (stores.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Crie uma loja antes", 400);
    if (stores.length > 1) throw new AppError(ErrorCode.ValidationFailed, "Selecione a loja", 400);
    return stores[0]!.id;
  }

  // ============================== PEDIDOS ==============================

  /** Lista pedidos com nomes (cliente/medico/lab/lote) resolvidos. */
  async listOrders(ctx: RequestContext, opts?: { status?: string; batchId?: string }) {
    this.requireOrg(ctx);
    const orders = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.findMany({
        where: {
          ...(opts?.status ? { status: opts.status } : {}),
          ...(opts?.batchId ? { labBatchId: opts.batchId } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: { batch: { select: { code: true } } },
        take: 500,
      }),
    );
    return this.enrich(ctx, orders);
  }

  private async enrich(ctx: RequestContext, orders: any[]) {
    const custIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))] as string[];
    const supIds = [
      ...new Set(orders.flatMap((o) => [o.doctorSupplierId, o.labSupplierId]).filter(Boolean)),
    ] as string[];
    const [custs, sups] = await Promise.all([
      custIds.length
        ? this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } }))
        : Promise.resolve([] as any[]),
      supIds.length
        ? this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } }))
        : Promise.resolve([] as any[]),
    ]);
    const cm = new Map(custs.map((c: any) => [c.id, c.name]));
    const sm = new Map(sups.map((s: any) => [s.id, s.name]));
    return orders.map((o) => ({
      ...o,
      customerName: o.customerId ? cm.get(o.customerId) ?? null : null,
      doctorName: o.doctorSupplierId ? sm.get(o.doctorSupplierId) ?? null : null,
      labName: o.labSupplierId ? sm.get(o.labSupplierId) ?? null : null,
      batchCode: o.batch?.code ?? null,
    }));
  }

  async getOrder(ctx: RequestContext, id: string) {
    const o = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.findFirst({ where: { id }, include: { batch: { select: { code: true } } } }),
    );
    if (!o) throw new AppError(ErrorCode.NotFound, "Pedido nao encontrado", 404);
    return (await this.enrich(ctx, [o]))[0];
  }

  /**
   * Vendas pagas de um cliente, com os itens já categorizados em óculos × lente,
   * pra o pedido de lente auto-preencher (puxa o ID da compra).
   */
  async eligibleSales(ctx: RequestContext, customerId: string) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const sales = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.findMany({
        where: { customerId, OR: [{ status: { in: ["completed", "paid"] } }, { creditPurchaseId: { not: null } }] },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { items: true },
      }),
    );
    const prodIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.productId).filter(Boolean) as string[]))];
    const prods = prodIds.length
      ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, category: true, laboratorySupplierId: true } }))
      : [];
    const byId = new Map(prods.map((p) => [p.id, p]));
    return sales.map((s) => {
      let frame: { id: string; name: string } | null = null;
      let lens: { id: string; name: string; labSupplierId: string | null } | null = null;
      for (const it of s.items) {
        const p = it.productId ? byId.get(it.productId) : undefined;
        const cat = (p?.category ?? "").toLowerCase();
        if (cat.includes("lente") && it.productId) lens = lens ?? { id: it.productId, name: it.productName, labSupplierId: p?.laboratorySupplierId ?? null };
        else if (it.productId) frame = frame ?? { id: it.productId, name: it.productName };
      }
      return {
        id: s.id,
        createdAt: s.createdAt,
        totalCents: Number(s.totalCents),
        paymentMethod: s.paymentMethod,
        items: s.items.map((i) => ({ name: i.productName, qty: i.qty })),
        frame,
        lens,
      };
    });
  }

  async createOrder(ctx: RequestContext, input: CreateOrderInput) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const orgId = this.requireOrg(ctx);
    const storeId = await this.resolveStoreId(ctx, input.storeId);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      // ---- automação: puxa óculos + lente + lab a partir da venda paga ----
      let frameProductId = input.frameProductId ?? null;
      let lensProductId = input.lensProductId ?? null;
      let labSupplierId = input.labSupplierId ?? null;
      let customerId = input.customerId ?? null;
      if (input.saleId) {
        const sale = await tx.sale.findFirst({
          where: { id: input.saleId },
          include: { items: true },
        });
        if (!sale) throw new AppError(ErrorCode.NotFound, "Venda não encontrada", 404);
        // só pedido de lente de venda paga (qualquer pagamento confirmado)
        if (!["completed", "paid"].includes(sale.status) && !sale.creditPurchaseId) {
          throw new AppError(ErrorCode.ValidationFailed, "A venda precisa estar paga para pedir a lente", 400);
        }
        customerId = customerId ?? sale.customerId ?? null;
        // categoriza os itens da venda: lente vs armação/óculos
        const prodIds = sale.items.map((i) => i.productId).filter(Boolean) as string[];
        const prods = prodIds.length
          ? await tx.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, category: true, laboratorySupplierId: true } })
          : [];
        const byId = new Map(prods.map((p) => [p.id, p]));
        for (const it of sale.items) {
          if (!it.productId) continue;
          const p = byId.get(it.productId);
          const cat = (p?.category ?? "").toLowerCase();
          if (cat.includes("lente")) { lensProductId = lensProductId ?? it.productId; if (!labSupplierId && p?.laboratorySupplierId) labSupplierId = p.laboratorySupplierId; }
          else { frameProductId = frameProductId ?? it.productId; }
        }
      }
      // lente → puxa o laboratório vinculado (se ainda não veio)
      if (lensProductId && !labSupplierId) {
        const lp = await tx.product.findFirst({ where: { id: lensProductId }, select: { laboratorySupplierId: true } });
        if (lp?.laboratorySupplierId) labSupplierId = lp.laboratorySupplierId;
      }

      // lente vinculada a um produto → puxa preço (cobrado) e custo (lab),
      // a menos que o operador tenha digitado "outro valor" (envia explícito).
      let customerPrice = input.customerPriceCents;
      let labCost = input.labCostCents;
      if (lensProductId) {
        const lens = await tx.product.findFirst({ where: { id: lensProductId }, select: { priceCashCents: true, costCents: true } });
        if (lens) {
          if (customerPrice == null && lens.priceCashCents != null) customerPrice = lens.priceCashCents;
          if (labCost == null && lens.costCents != null) labCost = lens.costCents;
        }
      }
      const order = await tx.lensOrder.create({
        data: {
          organizationId: orgId,
          storeId,
          customerId: customerId ?? null,
          saleId: input.saleId ?? null,
          doctorSupplierId: input.doctorSupplierId ?? null,
          labSupplierId: labSupplierId ?? null,
          frameProductId: frameProductId ?? null,
          lensProductId: lensProductId ?? null,
          osNumber: input.osNumber?.trim() || null,
          prescription: (input.prescription ?? {}) as any,
          examAttachmentUrl: input.examAttachmentUrl ?? null,
          customerPriceCents: customerPrice != null ? BigInt(customerPrice) : null,
          labCostCents: labCost != null ? BigInt(labCost) : null,
          notes: input.notes ?? null,
          sellerUserId: input.sellerUserId ?? null,
          productDescription: input.productDescription ?? null,
          productPhotoUrl: input.productPhotoUrl ?? null,
          createdByUserId: ctx.userId ?? null,
          status: "medido",
          measuredAt: new Date(),
        },
      });
      // baixa de estoque do óculos (frame), se controlar estoque.
      // Quando veio de uma venda, o estoque já baixou no PDV — não baixa de novo.
      if (frameProductId && !input.saleId) {
        await tx.product.updateMany({
          where: { id: frameProductId, trackStock: true },
          data: { stockQty: { decrement: 1 } },
        }).catch(() => undefined);
      }
      return order;
    });
  }

  async updateOrder(ctx: RequestContext, id: string, input: Partial<CreateOrderInput>) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    await this.getOrder(ctx, id);
    const data: Record<string, unknown> = {};
    if (input.customerId !== undefined) data.customerId = input.customerId;
    if (input.doctorSupplierId !== undefined) data.doctorSupplierId = input.doctorSupplierId;
    if (input.labSupplierId !== undefined) data.labSupplierId = input.labSupplierId;
    if (input.prescription !== undefined) data.prescription = input.prescription as any;
    if (input.examAttachmentUrl !== undefined) data.examAttachmentUrl = input.examAttachmentUrl;
    if (input.customerPriceCents !== undefined) data.customerPriceCents = input.customerPriceCents != null ? BigInt(input.customerPriceCents) : null;
    if (input.labCostCents !== undefined) data.labCostCents = input.labCostCents != null ? BigInt(input.labCostCents) : null;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.sellerUserId !== undefined) data.sellerUserId = input.sellerUserId;
    if (input.productDescription !== undefined) data.productDescription = input.productDescription;
    if (input.productPhotoUrl !== undefined) data.productPhotoUrl = input.productPhotoUrl;
    if (input.frameProductId !== undefined) data.frameProductId = input.frameProductId;
    if (input.lensProductId !== undefined) data.lensProductId = input.lensProductId;
    if (input.osNumber !== undefined) data.osNumber = input.osNumber?.trim() || null;
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.lensOrder.update({ where: { id }, data }));
  }

  /**
   * Anexa a nota fiscal ao pedido e avisa o cliente (WhatsApp com o arquivo +
   * email com link). A NF fica disponível no portal do cliente.
   */
  async attachInvoice(ctx: RequestContext, id: string, input: { nfNumber?: string | null; nfUrl: string }) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const orgId = this.requireOrg(ctx);
    const order = await this.getOrder(ctx, id);

    const updated = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.update({
        where: { id },
        data: { nfNumber: input.nfNumber ?? null, nfUrl: input.nfUrl, nfAttachedAt: new Date() },
      }),
    );

    let customer: any = null;
    if (order.customerId) {
      customer = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.customer.findFirst({ where: { id: order.customerId! }, select: { name: true, phone: true, whatsappPhone: true, email: true } }),
      );
    }
    const firstName = (customer?.name ?? "Cliente").split(" ")[0];
    const nfTxt = input.nfNumber ? ` (NF ${input.nfNumber})` : "";
    const text = `Olá ${firstName}! A nota fiscal do seu pedido${nfTxt} já está disponível. Você também encontra no seu portal.`;
    try {
      await this.notifications.notify({
        organizationId: orgId,
        storeId: order.storeId,
        customerId: order.customerId,
        whatsappPhone: customer?.whatsappPhone ?? customer?.phone ?? null,
        email: customer?.email ?? null,
        subject: "Sua nota fiscal",
        text,
        templateCode: "nota_fiscal",
        media: { url: input.nfUrl, fileName: input.nfNumber ? `NF-${input.nfNumber}` : "nota-fiscal", mediatype: "document" },
      });
    } catch { /* best-effort */ }
    return updated;
  }

  /** Marca um pedido como chegou (sem passar por lote). */
  async markArrived(ctx: RequestContext, id: string) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    await this.getOrder(ctx, id);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.update({ where: { id }, data: { status: "chegou", arrivedAt: new Date(), late: false } }),
    );
  }

  /** Avisa o cliente (WhatsApp/email) que a lente chegou -> status avisado. */
  async notifyArrival(ctx: RequestContext, id: string) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const orgId = this.requireOrg(ctx);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.findFirst({ where: { id } }),
    );
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido nao encontrado", 404);
    if (order.status !== "chegou") {
      throw new AppError(ErrorCode.ValidationFailed, "So avisa quando a lente chegou", 400);
    }
    let customer: any = null;
    if (order.customerId) {
      customer = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.customer.findFirst({ where: { id: order.customerId! }, select: { name: true, phone: true, whatsappPhone: true, email: true } }),
      );
    }
    const firstName = (customer?.name ?? "Cliente").split(" ")[0];
    const text = `Olá ${firstName}! Sua lente já chegou na loja e está pronta para retirada. 🎉`;
    await this.notifications.notify({
      organizationId: orgId,
      storeId: order.storeId,
      customerId: order.customerId,
      whatsappPhone: customer?.whatsappPhone ?? customer?.phone ?? null,
      email: customer?.email ?? null,
      subject: "Sua lente chegou!",
      text,
      templateCode: "lente_chegou",
    });
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.update({ where: { id }, data: { status: "avisado", notifiedAt: new Date() } }),
    );
  }

  async deliver(ctx: RequestContext, id: string) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const order = await this.getOrder(ctx, id);
    const updated = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.lensOrder.update({ where: { id }, data: { status: "entregue", deliveredAt: new Date() } }),
    );
    // dispara pesquisa de satisfação (NPS) — best-effort, não bloqueia a entrega
    try {
      await this.surveys.createAndSend({
        organizationId: order.organizationId,
        storeId: order.storeId,
        customerId: order.customerId ?? null,
        sellerUserId: order.sellerUserId ?? null,
        kind: "lens_order",
        refId: order.id,
        stage: "entregue",
      });
    } catch { /* ignora */ }
    return updated;
  }

  // ============================== LOTES ==============================

  async listBatches(ctx: RequestContext, opts?: { status?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.labBatch.findMany({
        where: { ...(opts?.status ? { status: opts.status } : {}) },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { orders: true } } },
        take: 200,
      }),
    );
  }

  /** Gera codigo YYYYMMDD-NN sequencial do dia. */
  private async nextBatchCode(ctx: RequestContext, orgId: string): Promise<string> {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const count = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.labBatch.count({ where: { organizationId: orgId, code: { startsWith: `${ymd}-` } } }),
    );
    return `${ymd}-${String(count + 1).padStart(2, "0")}`;
  }

  /** Cria um lote agrupando pedidos 'medido' e os marca como 'solicitado'. */
  async createBatch(
    ctx: RequestContext,
    input: { labSupplierId?: string | null; orderIds: string[]; courierUserId?: string | null; notes?: string | null },
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const orgId = this.requireOrg(ctx);
    if (!input.orderIds?.length) throw new AppError(ErrorCode.ValidationFailed, "Selecione ao menos um pedido", 400);

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const orders = await tx.lensOrder.findMany({ where: { id: { in: input.orderIds } } });
      if (orders.length !== input.orderIds.length) {
        throw new AppError(ErrorCode.ValidationFailed, "Pedido(s) invalido(s)", 400);
      }
      if (orders.some((o) => o.status !== "medido")) {
        throw new AppError(ErrorCode.ValidationFailed, "So pedidos 'medido' podem entrar no lote", 400);
      }
      const code = await this.nextBatchCode(ctx, orgId);
      const storeId = orders[0]!.storeId;
      const batch = await tx.labBatch.create({
        data: {
          organizationId: orgId,
          storeId,
          labSupplierId: input.labSupplierId ?? null,
          code,
          status: "pendente",
          courierUserId: input.courierUserId ?? null,
          notes: input.notes ?? null,
          sentAt: new Date(),
        },
      });
      await tx.lensOrder.updateMany({
        where: { id: { in: input.orderIds } },
        data: {
          labBatchId: batch.id,
          labSupplierId: input.labSupplierId ?? undefined,
          status: "solicitado",
          requestedAt: new Date(),
        },
      });
      return batch;
    });
  }

  /**
   * Conferencia do lote na volta: marca chegou (arrived) ou atrasado (late
   * com novo prazo). Atualiza o status do lote.
   */
  async conferBatch(
    ctx: RequestContext,
    batchId: string,
    input: { arrived: string[]; late?: Array<{ orderId: string; expectedAt?: string | null }> },
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const batch = await tx.labBatch.findFirst({ where: { id: batchId } });
      if (!batch) throw new AppError(ErrorCode.NotFound, "Lote nao encontrado", 404);

      if (input.arrived?.length) {
        await tx.lensOrder.updateMany({
          where: { id: { in: input.arrived }, labBatchId: batchId },
          data: { status: "chegou", arrivedAt: new Date(), late: false },
        });
      }
      for (const l of input.late ?? []) {
        await tx.lensOrder.update({
          where: { id: l.orderId },
          data: { late: true, expectedAt: l.expectedAt ? new Date(l.expectedAt) : null },
        });
      }
      // status do lote: recebido se nada pendente (status ainda 'solicitado'), senao parcial
      const pending = await tx.lensOrder.count({
        where: { labBatchId: batchId, status: "solicitado" },
      });
      const stillLate = await tx.lensOrder.count({ where: { labBatchId: batchId, late: true } });
      const status = pending === 0 && stillLate === 0 ? "recebido" : "recebido_parcial";
      await tx.labBatch.update({
        where: { id: batchId },
        data: { status, receivedAt: status === "recebido" ? new Date() : null },
      });
      return { ok: true, status };
    });
  }

  /** HTML branded do lote (folha pra levar ao laboratorio). */
  async batchHtml(ctx: RequestContext, batchId: string): Promise<string> {
    const orgId = this.requireOrg(ctx);
    const data = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const batch = await tx.labBatch.findFirst({ where: { id: batchId } });
      if (!batch) throw new AppError(ErrorCode.NotFound, "Lote nao encontrado", 404);
      const orders = await tx.lensOrder.findMany({ where: { labBatchId: batchId }, orderBy: { createdAt: "asc" } });
      const org = await tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true } });
      const lab = batch.labSupplierId
        ? await tx.supplier.findFirst({ where: { id: batch.labSupplierId }, select: { name: true } })
        : null;
      const custIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))] as string[];
      const custs = custIds.length
        ? await tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })
        : [];
      return { batch, orders, org, lab, custs };
    });
    const cm = new Map(data.custs.map((c: any) => [c.id, c.name]));
    return buildBatchSheet({
      brandName: data.org?.name ?? "Empresa",
      logoUrl: data.org?.logoUrl ?? null,
      color: data.org?.primaryColor ?? "#7c3aed",
      code: data.batch.code,
      labName: data.lab?.name ?? null,
      date: data.batch.sentAt ?? data.batch.createdAt,
      rows: data.orders.map((o: any) => ({
        os: o.osNumber || o.id.slice(0, 8).toUpperCase(), // OS manual ou id interno
        customer: o.customerId ? cm.get(o.customerId) ?? "—" : "—",
        prescription: o.prescription ?? {},
        notes: o.notes ?? "",
      })),
    });
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Resume as medidas OD/OE em texto curto. */
function rxSummary(rx: any): string {
  if (!rx || typeof rx !== "object") return "—";
  const eye = (e: any) =>
    e ? `esf ${e.esf ?? "-"} cil ${e.cil ?? "-"} eixo ${e.eixo ?? "-"} dnp ${e.dnp ?? "-"} ad ${e.adicao ?? "-"}` : "-";
  const od = rx.od ? `OD: ${eye(rx.od)}` : "";
  const oe = rx.oe ? `OE: ${eye(rx.oe)}` : "";
  const extra = [rx.tipo, rx.tratamentos, rx.armacao].filter(Boolean).join(" · ");
  return [od, oe, extra].filter(Boolean).join(" | ") || "—";
}

function buildBatchSheet(opts: {
  brandName: string;
  logoUrl: string | null;
  color: string;
  code: string;
  labName: string | null;
  date: Date;
  rows: Array<{ os: string; customer: string; prescription: any; notes: string }>;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${esc(opts.brandName)}</span>`;
  const rows = opts.rows
    .map(
      (r, i) => `<tr>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${i + 1}</td>
        <td style="padding:8px;border:1px solid #ddd;font-family:monospace;font-size:12px">${esc(r.os)}</td>
        <td style="padding:8px;border:1px solid #ddd">${esc(r.customer)}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:12px">${esc(rxSummary(r.prescription))}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:12px">${esc(r.notes)}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Lote ${esc(opts.code)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:820px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:8px}
  h1{font-size:18px;margin:16px 0 4px;color:${color}}
  .meta{font-size:12px;color:#555}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:${color};color:#fff;padding:8px;border:1px solid ${color};font-size:12px;text-align:left}
  .toolbar{text-align:center;padding:10px}
  .toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir</button></div>
  <div class="page">
    <header>${header}<span style="font-weight:700;color:${color}">LOTE ${esc(opts.code)}</span></header>
    <h1>Romaneio de envio ao laboratório</h1>
    <p class="meta">Laboratório: ${esc(opts.labName ?? "—")} · Data: ${new Date(opts.date).toLocaleDateString("pt-BR")} · ${opts.rows.length} pedido(s)</p>
    <table>
      <thead><tr><th style="width:36px">#</th><th>OS</th><th>Cliente</th><th>Medidas</th><th>Obs.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body></html>`;
}
