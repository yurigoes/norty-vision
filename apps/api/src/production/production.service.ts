import { Injectable, Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { SurveysService } from "../surveys/surveys.service";
import { NfseService } from "../fiscal/nfse.service";
import { StorageService } from "../storage/storage.service";
import { normalizeBRPhone } from "../customers/customers.service";
import { applyStoreStockDelta } from "../products/products.service";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";

interface ItemInput { description: string; qty: number; unitPriceCents: number }
interface UpsertInput {
  customerId?: string | null;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  storeId?: string | null;
  delivery?: boolean;
  dueDate?: string | null;
  downPaymentCents?: number;
  paymentStatus?: "none" | "partial" | "paid";
  paymentMethod?: string | null;
  needsInvoice?: boolean;
  fiscalCpf?: string | null;
  fiscalAddress?: string | null;
  fiscalBirthDate?: string | null;
  notes?: string | null;
  discountCents?: number;
  discountAuthRequestId?: string | null;
  discountAuthCode?: string | null;
  items: ItemInput[];
}

// Ordem CANÔNICA de todos os status possíveis. As etapas marcadas como OPCIONAIS
// só aparecem no kanban quando a org liga em Atendimento → Configurações:
//   - "estampa" entre producao e costura (gráficas que estampam internamente)
//   - "embalagem" entre pronto e entrega (gráficas que separam o pacote final)
// O service expõe `activeStagesFor(orgId)` que filtra a lista canônica.
const STATUS_ORDER = ["novo", "arte", "producao", "estampa", "costura", "separacao", "pronto", "embalagem", "entrega", "finalizado"];
const OPTIONAL_STAGES = ["estampa", "embalagem"] as const;
const STATUS_LABEL: Record<string, string> = {
  novo: "Pedido", arte: "Arte", producao: "Produção", estampa: "Estampa", costura: "Costura",
  separacao: "Separação", pronto: "Pronto", embalagem: "Embalagem", entrega: "Entrega",
  finalizado: "Finalizado", cancelado: "Cancelado",
};

function genShortCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return `PRD-${s}`;
}

@Injectable()
export class ProductionService {
  private readonly logger = new Logger("Production");
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService, private readonly surveys: SurveysService, private readonly nfse: NfseService, private readonly storage: StorageService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403); }

  /** Defesa em profundidade dos SUB-MÓDULOS da Produção (Fase 2). A UI já
   *  esconde a aba/tela, mas o endpoint também recusa quando o master desligou
   *  aquele sub-módulo pra empresa. Default-on: só bloqueia se estiver false.
   *  Master (isPlatformAdmin) passa sempre. */
  async assertSubmodule(ctx: RequestContext, key: string): Promise<void> {
    if (ctx.isPlatformAdmin || !ctx.orgId) return;
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId: ctx.orgId! }, select: { submoduleFeatures: true, productionFeatures: true } }),
    ).catch(() => null);
    // mapa genérico ("producao.<key>") com fallback ao legado ("<key>")
    const sf = (s as any)?.submoduleFeatures;
    const off = (sf && typeof sf === "object" && !Array.isArray(sf))
      ? sf[`producao.${key}`] === false
      : ((s as any)?.productionFeatures?.[key] === false);
    if (off) throw new AppError(ErrorCode.Forbidden, "Sub-módulo da produção indisponível para esta empresa", 403);
  }

  /** Estágios ATIVOS pra essa org — filtra estampa/embalagem conforme config.
   *  Usado pelo kanban (front) e pelo "avançar status" (pular etapas off). */
  async activeStagesFor(ctx: RequestContext): Promise<{ stages: string[]; labels: Record<string, string> }> {
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId: ctx.orgId! }, select: { productionStampEnabled: true, productionPackagingEnabled: true } }),
    ).catch(() => null);
    const stampOn = (s as any)?.productionStampEnabled ?? false;
    const packOn = (s as any)?.productionPackagingEnabled ?? false;
    const stages = STATUS_ORDER.filter((st) => (st === "estampa" ? stampOn : st === "embalagem" ? packOn : true));
    return { stages, labels: STATUS_LABEL };
  }

  /** Anexa a assinatura simplificada do cliente à OS na finalização.
   *  Recebe um dataURL (data:image/png;base64,...) do canvas do front, sobe
   *  pro storage e grava URL/timestamp/IP no pedido. Sem hash de integridade —
   *  é só comprovação visual de que o cliente conferiu/recebeu. */
  async saveCustomerSignature(ctx: RequestContext, id: string, signatureDataUrl: string, ip: string | null): Promise<any> {
    this.requireOrg(ctx);
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(signatureDataUrl);
    if (!m) throw new AppError(ErrorCode.ValidationFailed, "Assinatura inválida (esperado data:image/png;base64,...)", 400);
    const mime = m[1]!.toLowerCase();
    const buf = Buffer.from(m[2]!, "base64");
    if (buf.length < 200 || buf.length > 2_000_000) throw new AppError(ErrorCode.ValidationFailed, "Tamanho da assinatura fora do esperado", 400);
    const up = await this.storage.putPublic({
      keyPrefix: `production/signatures/${ctx.orgId}`,
      contentType: mime,
      body: buf,
      originalName: `assinatura-${id}.png`,
    });
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.update({
        where: { id },
        data: { customerSignatureUrl: up.url, customerSignedAt: new Date(), customerSignatureIp: ip ?? null },
        include: { items: true, files: true },
      }),
    );
  }

  private totals(items: ItemInput[]) {
    const lines = items.map((it) => ({ description: it.description, qty: Math.max(1, Math.trunc(it.qty)), unitPriceCents: Math.max(0, Math.round(it.unitPriceCents)), lineTotalCents: Math.max(0, Math.round(it.unitPriceCents)) * Math.max(1, Math.trunc(it.qty)) }));
    return { lines, total: lines.reduce((s, l) => s + l.lineTotalCents, 0) };
  }

  async list(ctx: RequestContext, opts?: { status?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.findMany({ where: { ...(opts?.status ? { status: opts.status } : {}) }, orderBy: { createdAt: "desc" }, include: { items: true, files: true }, take: 500 }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const o = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.findFirst({ where: { id }, include: { items: true, files: { orderBy: { createdAt: "desc" } }, reviews: { orderBy: { createdAt: "desc" } }, roster: { orderBy: { position: "asc" } }, fabrics: true, payments: { orderBy: { createdAt: "desc" } }, batch: { select: { id: true, name: true, status: true } } } }),
    );
    if (!o) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    // enriquece os tecidos com nome/saldo do produto pra exibir no painel
    const fabrics = (o as any).fabrics ?? [];
    if (fabrics.length) {
      const prods = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.product.findMany({ where: { id: { in: fabrics.map((f: any) => f.productId) } }, select: { id: true, name: true, sku: true, stockQty: true } }),
      );
      const byId = new Map(prods.map((p) => [p.id, p]));
      (o as any).fabrics = fabrics.map((f: any) => ({ ...f, productName: byId.get(f.productId)?.name ?? "Produto", productSku: byId.get(f.productId)?.sku ?? null, productStock: byId.get(f.productId)?.stockQty ?? 0 }));
    }
    return o;
  }

  // ============================== FICHA TÉCNICA (roster) ==============================
  /** Modelos da grade do pedido (normalizados). [] = sem grade. */
  private parseGrade(o: any): Array<{ key: string; label: string; sizes: string[] }> {
    const g = o?.sizeGrade;
    if (!Array.isArray(g)) return [];
    return g
      .filter((m: any) => m && typeof m.key === "string")
      .map((m: any) => ({ key: String(m.key), label: String(m.label ?? m.key), sizes: Array.isArray(m.sizes) ? m.sizes.map((s: any) => String(s)) : [] }));
  }

  /** Substitui a ficha técnica (jogador/número/tamanho/qtd) do pedido. Quando o
   *  pedido tem GRADE, valida modelKey + tamanho contra os modelos da grade. */
  async setRoster(ctx: RequestContext, id: string, rows: Array<{ playerName: string; number?: string | null; size?: string | null; qty?: number; notes?: string | null; modelKey?: string | null }>) {
    this.requireOrg(ctx);
    const o = await this.getById(ctx, id);
    const grade = this.parseGrade(o);
    const byKey = new Map(grade.map((m) => [m.key, m]));
    const clean = (rows ?? [])
      .map((r, i) => ({ playerName: (r.playerName ?? "").trim(), number: (r.number ?? "")?.toString().trim() || null, size: (r.size ?? "")?.toString().trim() || null, modelKey: (r.modelKey ?? "")?.toString().trim() || null, qty: Math.max(1, Math.trunc(r.qty ?? 1)), notes: (r.notes ?? "")?.toString().trim() || null, position: i }))
      .filter((r) => r.playerName.length > 0);
    // Com grade: cada linha precisa de um modelo válido e tamanho da lista dele.
    if (grade.length) {
      for (const r of clean) {
        if (!r.modelKey || !byKey.has(r.modelKey)) throw new AppError(ErrorCode.ValidationFailed, `Escolha o modelo de "${r.playerName}"`, 400);
        const m = byKey.get(r.modelKey)!;
        if (m.sizes.length && r.size && !m.sizes.includes(r.size)) throw new AppError(ErrorCode.ValidationFailed, `Tamanho "${r.size}" não existe no modelo "${m.label}"`, 400);
      }
    }
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.productionOrderRoster.deleteMany({ where: { orderId: id } });
      if (clean.length) await tx.productionOrderRoster.createMany({ data: clean.map((r) => ({ organizationId: o.organizationId, orderId: id, playerName: r.playerName, number: r.number, size: r.size, modelKey: r.modelKey, qty: r.qty, notes: r.notes, position: r.position })) });
      return tx.productionOrderRoster.findMany({ where: { orderId: id }, orderBy: { position: "asc" } });
    });
  }

  /** Define/atualiza a GRADE do pedido (modelos com tamanhos permitidos).
   *  Passar [] limpa a grade (volta ao tamanho texto livre). */
  async setGrade(ctx: RequestContext, id: string, models: Array<{ key?: string | null; label: string; sizes: string[] }>) {
    this.requireOrg(ctx);
    await this.getById(ctx, id); // garante que existe e é da org
    const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const seen = new Set<string>();
    const clean = (models ?? [])
      .map((m) => ({ label: (m.label ?? "").trim(), sizes: Array.from(new Set((m.sizes ?? []).map((s) => String(s).trim()).filter(Boolean))), key: (m.key ?? "").toString().trim() }))
      .filter((m) => m.label.length > 0)
      .map((m) => {
        let key = m.key || slug(m.label) || "modelo";
        while (seen.has(key)) key = `${key}-2`;
        seen.add(key);
        return { key, label: m.label, sizes: m.sizes };
      });
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.update({ where: { id }, data: { sizeGrade: clean.length ? (clean as any) : null }, select: { id: true, sizeGrade: true } }),
    );
  }

  // ============================== LOTE (batch) ==============================
  /** Lista os lotes com contagem de pedidos e o prazo mais próximo. */
  async listBatches(ctx: RequestContext) {
    this.requireOrg(ctx);
    const batches = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionBatch.findMany({ orderBy: { createdAt: "desc" }, include: { orders: { select: { id: true, shortCode: true, contactName: true, status: true, dueDate: true, totalCents: true } } }, take: 200 }),
    );
    return batches.map((b) => {
      const dues = b.orders.map((o) => o.dueDate).filter(Boolean) as Date[];
      const nextDue = dues.length ? new Date(Math.min(...dues.map((d) => new Date(d).getTime()))) : null;
      const total = b.orders.reduce((s, o) => s + Number(o.totalCents), 0);
      return { id: b.id, name: b.name, status: b.status, notes: b.notes, createdAt: b.createdAt, orderCount: b.orders.length, nextDue, totalCents: String(total), orders: b.orders.map((o) => ({ ...o, totalCents: String(o.totalCents) })) };
    });
  }

  /** Cria um lote e (opcionalmente) já atribui pedidos a ele. */
  async createBatch(ctx: RequestContext, input: { name: string; storeId?: string | null; orderIds?: string[]; notes?: string | null }) {
    this.requireOrg(ctx);
    const name = (input.name ?? "").trim();
    if (!name) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome do lote", 400);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const batch = await tx.productionBatch.create({ data: { organizationId: ctx.orgId!, storeId: input.storeId ?? null, name, notes: input.notes ?? null, createdByUserId: ctx.userId ?? null } });
      const ids = (input.orderIds ?? []).filter(Boolean);
      if (ids.length) await tx.productionOrder.updateMany({ where: { id: { in: ids } }, data: { batchId: batch.id } });
      return batch;
    });
  }

  /** Define exatamente quais pedidos pertencem ao lote (substitui o conjunto). */
  async setBatchOrders(ctx: RequestContext, batchId: string, orderIds: string[]) {
    this.requireOrg(ctx);
    const batch = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionBatch.findFirst({ where: { id: batchId }, select: { id: true } }));
    if (!batch) throw new AppError(ErrorCode.NotFound, "Lote não encontrado", 404);
    const ids = (orderIds ?? []).filter(Boolean);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.productionOrder.updateMany({ where: { batchId }, data: { batchId: null } });
      if (ids.length) await tx.productionOrder.updateMany({ where: { id: { in: ids } }, data: { batchId } });
      return { ok: true, count: ids.length };
    });
  }

  /**
   * Muda o status do lote. Quando vira "producao", avança os pedidos do lote
   * que ainda estão em etapas iniciais (novo/arte/costura) para "producao".
   */
  async setBatchStatus(ctx: RequestContext, batchId: string, status: string) {
    this.requireOrg(ctx);
    if (!["aberto", "producao", "concluido", "cancelado"].includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status de lote inválido", 400);
    const batch = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionBatch.findFirst({ where: { id: batchId }, include: { orders: { select: { id: true, status: true } } } }));
    if (!batch) throw new AppError(ErrorCode.NotFound, "Lote não encontrado", 404);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionBatch.update({ where: { id: batchId }, data: { status } }));
    if (status === "producao") {
      const advance = batch.orders.filter((o) => ["novo", "arte", "costura"].includes(o.status)).map((o) => o.id);
      if (advance.length) await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.updateMany({ where: { id: { in: advance } }, data: { status: "producao" } }));
    }
    return this.listBatches(ctx).then((all) => all.find((b) => b.id === batchId) ?? null);
  }

  async removeBatch(ctx: RequestContext, batchId: string) {
    this.requireOrg(ctx);
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.productionOrder.updateMany({ where: { batchId }, data: { batchId: null } });
      await tx.productionBatch.deleteMany({ where: { id: batchId } });
    });
    return { ok: true };
  }

  async create(ctx: RequestContext, input: UpsertInput) {
    this.requireOrg(ctx);
    if (!input.items?.length) throw new AppError(ErrorCode.ValidationFailed, "Pedido sem itens", 400);
    const { lines, total: gross } = this.totals(input.items);
    // desconto (R$) no total. Até X% (configurável em Atendimento → Config) o
    // vendedor aplica sozinho; acima disso exige autorização do admin via
    // código de 4 dígitos (modal). 0 = sempre exige (comportamento antigo).
    let discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
    let discountBy: string | null = null;
    if (discountCents > 0) {
      const maxOperatorPct = await this.maxOperatorDiscountPct(ctx);
      const appliedPct = gross > 0 ? (discountCents / gross) * 100 : 0;
      const withinLimit = appliedPct <= maxOperatorPct + 1e-6;
      if (!withinLimit) {
        if (!input.discountAuthRequestId || !input.discountAuthCode) {
          throw new AppError(ErrorCode.ValidationFailed, `Desconto de ${appliedPct.toFixed(2)}% passa do limite do vendedor (${maxOperatorPct.toFixed(2)}%). Solicite autorização.`, 400);
        }
        const v = await this.verifyDiscountAuth(ctx, input.discountAuthRequestId, input.discountAuthCode);
        discountBy = v.adminName;
        if (v.amountCents > 0) discountCents = Math.min(discountCents, v.amountCents);
      }
    }
    const total = Math.max(0, gross - discountCents);
    const down = Math.max(0, input.downPaymentCents ?? 0);
    // status de pagamento derivado da entrada vs total (se não vier explícito):
    // 0 = none, >=total = paid, no meio = partial (entrada paga, falta o resto).
    const derivedPayStatus = down <= 0 ? "none" : down >= total ? "paid" : "partial";

    // Cliente: resolve ANTES da transação principal pra não poluir a tx com erros
    // do customer (caso raro: RLS/constraint). Antes ficava `await resolveOrCreate(...)
    // .catch(...)` DENTRO do tx — o catch engolia o erro no JS mas o Postgres já
    // tinha abortado a tx, e o próximo `productionOrder.create` quebrava com
    // 25P02 ("current transaction is aborted"). A busca/criação do customer não
    // precisa ser atômica com o pedido — se falhar, o pedido pode seguir sem ele.
    let customerId = input.customerId ?? null;
    let createdCustomer = false;
    if (!customerId) {
      try {
        const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => this.resolveOrCreateCustomer(ctx, tx, input));
        if (r) { customerId = r.id; createdCustomer = r.created; }
      } catch (e: any) {
        // Loga mas não derruba o pedido — cliente pode ser linkado depois manualmente
        this.logger.warn(`resolveOrCreateCustomer falhou (pedido segue sem customerId): ${e?.message ?? e}`);
      }
    }

    let shortCode = genShortCode();
    const res = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      for (let i = 0; i < 5; i++) { if (!(await tx.productionOrder.findFirst({ where: { shortCode }, select: { id: true } }))) break; shortCode = genShortCode(); }
      const order = await tx.productionOrder.create({
        data: {
          organizationId: ctx.orgId!, storeId: input.storeId ?? null, customerId, shortCode,
          contactName: input.contactName, contactPhone: input.contactPhone ?? null, contactEmail: input.contactEmail ?? null,
          delivery: !!input.delivery, dueDate: input.dueDate ? new Date(input.dueDate) : null,
          totalCents: BigInt(total), discountCents: BigInt(discountCents), discountAuthorizedBy: discountBy, downPaymentCents: BigInt(down),
          paymentStatus: input.paymentStatus ?? derivedPayStatus, paymentMethod: input.paymentMethod ?? null,
          needsInvoice: !!input.needsInvoice, notes: input.notes ?? null,
          fiscalCpf: input.fiscalCpf ?? null, fiscalAddress: input.fiscalAddress ?? null,
          fiscalBirthDate: input.fiscalBirthDate ? new Date(input.fiscalBirthDate) : null,
          sellerUserId: ctx.userId ?? null, createdByUserId: ctx.userId ?? null,
          items: { create: lines.map((l) => ({ organizationId: ctx.orgId!, description: l.description, qty: l.qty, unitPriceCents: BigInt(l.unitPriceCents), lineTotalCents: BigInt(l.lineTotalCents) })) },
        },
        include: { items: true },
      });
      return { order, customerId, createdCustomer };
    });
    // primeira vez do cliente → convida pro portal acompanhar o pedido (best-effort, fora da tx)
    if (res.createdCustomer && res.customerId) void this.sendPortalInvite(ctx, res.order, res.customerId).catch(() => undefined);
    return res.order;
  }

  /** Acha o cliente na base (telefone/e-mail/CPF) ou cadastra um novo. */
  private async resolveOrCreateCustomer(ctx: RequestContext, tx: any, input: UpsertInput): Promise<{ id: string; created: boolean } | null> {
    const phone = normalizeBRPhone(input.contactPhone);
    const email = (input.contactEmail ?? "").trim().toLowerCase() || null;
    const doc = (input.fiscalCpf ?? "").replace(/\D/g, "") || null;
    const or: any[] = [];
    if (phone) { or.push({ phone }, { whatsappPhone: phone }); }
    if (email) or.push({ email });
    if (doc) or.push({ document: doc });
    if (or.length) {
      const found = await tx.customer.findFirst({ where: { OR: or }, select: { id: true } });
      if (found) return { id: found.id, created: false };
    }
    // precisa de uma loja p/ cadastrar
    let storeId = input.storeId ?? ctx.storeId ?? null;
    if (!storeId) {
      const stores = await tx.store.findMany({ where: { organizationId: ctx.orgId!, deletedAt: null, status: "active" }, select: { id: true }, take: 2 });
      if (stores.length === 1) storeId = stores[0].id;
    }
    if (!storeId) return null; // sem loja definida → não cadastra (mantém só o contato no pedido)
    const c = await tx.customer.create({
      data: { organizationId: ctx.orgId!, storeId, name: input.contactName, phone, whatsappPhone: phone, email, document: doc, documentType: doc ? (doc.length === 11 ? "cpf" : "cnpj") : null, source: "producao" },
      select: { id: true },
    });
    return { id: c.id, created: true };
  }

  /** Convida o cliente recém-cadastrado a acompanhar o pedido pelo portal (login por telefone). */
  private async sendPortalInvite(ctx: RequestContext, order: any, customerId: string): Promise<void> {
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: ctx.orgId! }, select: { name: true, slug: true } })).catch(() => null);
    const portal = `${orgBaseUrl(org?.slug)}/c`;
    const first = (order.contactName ?? "").split(" ")[0] ?? "";
    const loja = org?.name ?? "nossa loja";
    const cod = order.shortCode ?? "";
    await this.notifications.notify({
      organizationId: ctx.orgId!, storeId: order.storeId ?? ctx.orgId!, customerId,
      whatsappPhone: order.contactPhone ?? null, email: order.contactEmail ?? null,
      subject: `Acompanhe seu pedido — ${loja}`,
      text: `Oi${first ? " " + first : ""}! 🎉 Recebemos seu pedido *${cod}* na ${loja}. Você pode acompanhar tudo (arte, produção e entrega) pelo nosso portal: ${portal}\nÉ só entrar com o seu telefone. 😊`,
      templateCode: "production_invite",
    }).catch(() => undefined);
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertInput>) {
    this.requireOrg(ctx);
    const cur0 = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id }, include: { items: true } }));
    if (!cur0) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    // desconto — exige autorização quando muda pra valor que passa do limite
    // configurável (% sobre o subtotal). Até esse limite, vendedor aplica sozinho.
    let discountChange: { cents: number; by: string | null } | null = null;
    if (input.discountCents !== undefined) {
      let discountCents = Math.max(0, Math.round(input.discountCents));
      let by: string | null = cur0.discountAuthorizedBy ?? null;
      const mudou = discountCents !== Number(cur0.discountCents ?? 0n);
      if (discountCents > 0 && mudou) {
        // gross = subtotal antes do desconto = totalCents + discountCents OU
        // soma dos items.lineTotalCents (mais confiável quando items mudam).
        const gross = (cur0.items ?? []).reduce(
          (s: number, it: any) => s + Number(it.lineTotalCents ?? 0n) * 1,
          0,
        ) || Number(cur0.totalCents ?? 0n) + Number(cur0.discountCents ?? 0n);
        const maxOperatorPct = await this.maxOperatorDiscountPct(ctx);
        const appliedPct = gross > 0 ? (discountCents / gross) * 100 : 0;
        const withinLimit = appliedPct <= maxOperatorPct + 1e-6;
        if (!withinLimit) {
          if (!input.discountAuthRequestId || !input.discountAuthCode) {
            throw new AppError(ErrorCode.ValidationFailed, `Desconto de ${appliedPct.toFixed(2)}% passa do limite do vendedor (${maxOperatorPct.toFixed(2)}%). Solicite autorização.`, 400);
          }
          const v = await this.verifyDiscountAuth(ctx, input.discountAuthRequestId, input.discountAuthCode);
          by = v.adminName;
          if (v.amountCents > 0) discountCents = Math.min(discountCents, v.amountCents);
        } else {
          // dentro do limite — não precisa de autorização; mas se quem chamou
          // ainda mandou autorização (excesso de cuidado), aceita e registra
          if (input.discountAuthRequestId && input.discountAuthCode) {
            const v = await this.verifyDiscountAuth(ctx, input.discountAuthRequestId, input.discountAuthCode);
            by = v.adminName;
          }
        }
      }
      if (discountCents === 0) by = null;
      discountChange = { cents: discountCents, by };
    }
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const cur = await tx.productionOrder.findFirst({ where: { id }, include: { items: true } });
      if (!cur) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
      const data: any = {};
      for (const k of ["contactName", "contactPhone", "contactEmail", "customerId", "storeId", "delivery", "paymentStatus", "paymentMethod", "needsInvoice", "fiscalCpf", "fiscalAddress", "notes"] as const) {
        if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
      }
      if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      if (input.fiscalBirthDate !== undefined) data.fiscalBirthDate = input.fiscalBirthDate ? new Date(input.fiscalBirthDate) : null;
      if (input.downPaymentCents !== undefined) data.downPaymentCents = BigInt(Math.max(0, input.downPaymentCents));
      // recalcula total quando itens e/ou desconto mudam
      const gross = input.items ? this.totals(input.items).total : (cur.items ?? []).reduce((s, l: any) => s + Number(l.lineTotalCents ?? 0), 0);
      const discountCents = discountChange ? discountChange.cents : Number(cur.discountCents ?? 0n);
      if (discountChange) { data.discountCents = BigInt(discountChange.cents); data.discountAuthorizedBy = discountChange.by; }
      if (input.items || discountChange) data.totalCents = BigInt(Math.max(0, gross - discountCents));
      if (input.items) {
        const { lines } = this.totals(input.items);
        await tx.productionOrderItem.deleteMany({ where: { orderId: id } });
        await tx.productionOrderItem.createMany({ data: lines.map((l) => ({ organizationId: cur.organizationId, orderId: id, description: l.description, qty: l.qty, unitPriceCents: BigInt(l.unitPriceCents), lineTotalCents: BigInt(l.lineTotalCents) })) });
      }
      await tx.productionOrder.update({ where: { id }, data });
      return tx.productionOrder.findFirst({ where: { id }, include: { items: true } });
    });
  }

  /** Avança/define o status de produção. Notifica o cliente ao chegar em "pronto". */
  async setStatus(ctx: RequestContext, id: string, status: string) {
    this.requireOrg(ctx);
    if (![...STATUS_ORDER, "cancelado", "cancelamento_solicitado"].includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    const o = await this.getById(ctx, id);
    // Cancelar com pagamento eletrônico (pix/cartão MP/InfinitePay) NÃO cancela direto:
    // vai p/ a fila de "cancelamento solicitado" pro admin estornar e cancelar a NF.
    if (status === "cancelado") {
      // qualquer pagamento PAGO em pix/cartão (gateway OU maquininha) precisa de estorno.
      // Só dinheiro (cash) cancela direto. kind=estorno não conta.
      const eletronico = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.findFirst({
        where: { orderId: id, status: "paid", kind: { not: "estorno" }, OR: [{ provider: { in: ["mp", "infinitepay"] } }, { method: { in: ["card", "card_machine", "pix", "pix_machine"] } }] },
        select: { id: true },
      })).catch(() => null);
      if (eletronico) {
        await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { status: "cancelamento_solicitado" } }));
        return this.getById(ctx, id);
      }
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { status } }));
    // ao entrar em "produção": baixa o tecido/insumos do estoque (uma única vez)
    if (status === "producao" && !o.fabricConsumedAt) {
      await this.consumeFabric(ctx, o).catch((e) => this.logger.warn(`consumo de tecido falhou (pedido ${id}): ${e?.message ?? e}`));
    }
    // acompanhamento do pedido pelo cliente (idempotente por flag de envio)
    if (status === "producao" && !o.producaoNotifiedAt) {
      await this.notifyCustomer(o, "producao").catch(() => undefined);
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { producaoNotifiedAt: new Date() } })).catch(() => undefined);
    }
    if (status === "entrega" && !o.entregaNotifiedAt) {
      await this.notifyCustomer(o, "entrega").catch(() => undefined);
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { entregaNotifiedAt: new Date() } })).catch(() => undefined);
    }
    if (status === "pronto" && !o.readyNotifiedAt) {
      await this.notifyCustomer(o, "pronto").catch(() => undefined);
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { readyNotifiedAt: new Date() } })).catch(() => undefined);
    }
    // pedido finalizado → dispara pesquisa de satisfação (NPS) ao cliente (dedup interno)
    if (status === "finalizado" && o.customerId) {
      void this.surveys.createAndSend({ organizationId: o.organizationId, storeId: o.storeId ?? null, customerId: o.customerId, kind: "production", refId: o.id, sellerUserId: o.sellerUserId ?? null });
    }
    return this.getById(ctx, id);
  }

  // ============================== CANCELAMENTO + ESTORNO ==============================
  /** Pedidos aguardando estorno/cancelamento (status cancelamento_solicitado). */
  async listCancelRequests(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findMany({
      where: { status: "cancelamento_solicitado" },
      orderBy: { updatedAt: "desc" }, take: 200,
      include: { items: true, payments: { orderBy: { createdAt: "desc" } } },
    }));
  }

  /**
   * Registra o estorno de um pedido em cancelamento: cria o lançamento (com
   * comprovante), cancela automaticamente a NFS-e vinculada (se autorizada) e
   * marca o pedido como cancelado.
   */
  async registerEstorno(ctx: RequestContext, id: string, input: { amountCents: number; method?: string | null; proofUrl?: string | null; notes?: string | null }): Promise<any> {
    this.requireOrg(ctx);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id }, select: { id: true } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    const amountCents = Math.max(0, Math.round(Number(input.amountCents) || 0));
    if (amountCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Informe o valor do estorno", 400);

    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.create({
      data: { organizationId: ctx.orgId!, orderId: id, kind: "estorno", method: input.method ?? null, provider: "manual", amountCents: BigInt(amountCents), status: "paid", paidAt: new Date(), proofUrl: input.proofUrl ?? null, notes: input.notes ?? null, createdBy: ctx.userId ?? null },
    }));

    // cancela a NFS-e vinculada (se houver autorizada)
    let nfse: any = null;
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.fiscalDocument.findFirst({ where: { productionOrderId: id, modelo: "99", status: "autorizada" }, select: { id: true } })).catch(() => null);
    if (doc) {
      nfse = await this.nfse.cancelarNfse(ctx, doc.id, `Cancelamento do pedido com estorno ao cliente. ${input.notes ?? ""}`.trim().slice(0, 255)).catch((e: any) => ({ status: "erro", motivo: e?.message ?? "falha" }));
    }

    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { status: "cancelado", paymentStatus: "refunded" } }));
    return { order: await this.getById(ctx, id), nfse };
  }

  // ============================== AUTORIZAÇÃO POR CÓDIGO (desconto) ==============================
  /** Lista admin/gerente/supervisor (com WhatsApp) p/ autorizar ações sensíveis (ex.: desconto). */
  async listAuthAdmins(ctx: RequestContext): Promise<any[]> {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findMany({
      where: { organizationId: orgId, status: "active", role: { slug: { in: ["owner", "admin", "manager", "gerente", "supervisor"] } } },
      select: { id: true, user: { select: { name: true, phone: true } }, role: { select: { name: true, slug: true } } },
    }));
    return rows.map((r) => ({ membershipId: r.id, name: r.user?.name ?? "—", role: r.role?.name ?? r.role?.slug ?? "", hasWhatsapp: !!r.user?.phone }));
  }

  /** Gera código de 4 dígitos e envia no WhatsApp do autorizador (desconto no pedido). */
  async requestDiscountAuth(ctx: RequestContext, body: { adminMembershipId: string; discountCents: number; orderId?: string | null }): Promise<any> {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    const discountCents = Math.max(0, Math.round(Number(body.discountCents) || 0));
    if (discountCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Informe o valor do desconto", 400);
    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: body.adminMembershipId, organizationId: orgId, status: "active" }, select: { id: true, user: { select: { name: true, phone: true } }, storeId: true } }));
    if (!admin) throw new AppError(ErrorCode.NotFound, "Autorizador não encontrado", 404);
    if (!admin.user?.phone) throw new AppError(ErrorCode.ValidationFailed, "Autorizador sem WhatsApp cadastrado", 400);

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.create({
      data: { organizationId: orgId, installmentId: null, adminMembershipId: admin.id, requestedBy: ctx.membershipId ?? null, purpose: "production_discount", codeHash, amountCents: BigInt(discountCents), meta: body.orderId ? { orderId: body.orderId } : undefined, expiresAt },
      select: { id: true },
    }));
    const valor = (discountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await this.notifications.notify({
      organizationId: orgId, storeId: admin.storeId ?? orgId, whatsappPhone: admin.user.phone,
      subject: "Autorização de desconto",
      text: `Código de autorização: ${code}\nDesconto de ${valor} num pedido de produção.\nInforme este código ao atendente. Válido por 15 minutos.`,
      templateCode: "credit_payment",
    }).catch(() => null);
    return { ok: true, requestId: rec.id, adminName: admin.user.name, expiresAt };
  }

  // ============================== COSTUREIRA (atribuição/portal) ==============================
  /**
   * Atribui (ou remove) uma costureira (Supplier type=costureira) ao pedido.
   * Não muda o status nem dispara nada — é só "esse aqui é seu". A costureira
   * vê automaticamente no portal dela. supplierId=null tira a atribuição.
   */
  async assignSupplier(ctx: RequestContext, orderId: string, supplierId: string | null) {
    this.requireOrg(ctx);
    const order = await this.getById(ctx, orderId);
    if (supplierId) {
      const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true, type: true, status: true, name: true, phone: true } }),
      );
      if (!s) throw new AppError(ErrorCode.NotFound, "Costureira/fornecedor não encontrado", 404);
      if (s.status !== "active") throw new AppError(ErrorCode.ValidationFailed, "Costureira inativa", 400);
      // notifica a costureira por WhatsApp (best-effort, não bloqueia)
      if (s.phone) {
        void this.notifyAssignedSupplier(order, s.name, s.phone).catch(() => undefined);
      }
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.update({ where: { id: orderId }, data: { assignedSupplierId: supplierId ?? null } }),
    );
    return this.getById(ctx, orderId);
  }

  /** Avisa a costureira por WhatsApp que ela recebeu uma nova OS. */
  private async notifyAssignedSupplier(order: any, supplierName: string, phone: string) {
    const orgId = order.organizationId;
    // Pega o slug pra montar a URL do portal da empresa
    const org = await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findUnique({ where: { id: orgId }, select: { slug: true } }))
      .catch(() => null);
    const link = `${orgBaseUrl(org?.slug ?? null)}/f`;
    const code = order.shortCode ?? order.id?.slice(0, 8);
    const due = order.dueDate ? ` · prazo ${new Date(order.dueDate).toLocaleDateString("pt-BR")}` : "";
    const first = supplierName.split(" ")[0] ?? supplierName;
    const text = `Oi ${first}! 🧵 Nova OS atribuída pra você: *#${code}*${due}.\n\nAcesse: ${link}\n\nQuando terminar, abra a OS e toque em "Pedido pronto".`;
    await this.notifications.notify({
      organizationId: orgId,
      storeId: order.storeId ?? orgId,
      whatsappPhone: phone,
      email: null,
      subject: `Nova OS atribuída — #${code}`,
      text,
      templateCode: "production_assigned_costureira",
    }).catch(() => undefined);
  }

  /**
   * Relatório admin de produção por costureira no período. Mostra todas as
   * OSs produzidas (producedAt no range), o total de peças, valor e quais já
   * foram pagas (incluídas em algum settlement).
   */
  async productionReportForSupplier(ctx: RequestContext, supplierId: string, opts: { from?: string; to?: string }) {
    this.requireOrg(ctx);
    const from = opts.from ? new Date(opts.from + "T00:00:00") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59") : new Date();
    const orders = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.findMany({
        where: {
          assignedSupplierId: supplierId,
          producedAt: { gte: from, lte: to },
        },
        orderBy: { producedAt: "desc" },
        take: 1000,
        include: {
          roster: { select: { qty: true } },
          items: { select: { qty: true } },
        },
      }),
    );
    const paidIds = orders.length
      ? new Set(
          (await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.settlementItem.findMany({
              where: { sourceType: "production_order", sourceId: { in: orders.map((o) => o.id) } },
              select: { sourceId: true },
            }),
          )).map((r) => r.sourceId),
        )
      : new Set<string>();
    const items = orders.map((o) => {
      const piecesRoster = (o.roster ?? []).reduce((s, r) => s + (r.qty ?? 0), 0);
      const piecesItems = (o.items ?? []).reduce((s, it) => s + (it.qty ?? 0), 0);
      const pieces = piecesRoster > 0 ? piecesRoster : piecesItems;
      return {
        id: o.id,
        shortCode: o.shortCode,
        contactName: o.contactName,
        producedAt: o.producedAt,
        pieces,
        valueCents: Number(o.productionPriceCents ?? 0n),
        paid: paidIds.has(o.id),
      };
    });
    const totals = items.reduce(
      (acc, it) => ({
        orders: acc.orders + 1,
        pieces: acc.pieces + it.pieces,
        valueCents: acc.valueCents + it.valueCents,
        paidCents: acc.paidCents + (it.paid ? it.valueCents : 0),
        pendingCents: acc.pendingCents + (it.paid ? 0 : it.valueCents),
      }),
      { orders: 0, pieces: 0, valueCents: 0, paidCents: 0, pendingCents: 0 },
    );
    return { from, to, items, totals };
  }

  /**
   * Lista as OSs prontas (producedAt != null) ainda NÃO inclusas em nenhum
   * settlement. É a "fila de pagamento" pendente da costureira.
   */
  async productionPendingForSupplier(ctx: RequestContext, supplierId: string) {
    this.requireOrg(ctx);
    const orders = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.findMany({
        where: { assignedSupplierId: supplierId, producedAt: { not: null } },
        orderBy: { producedAt: "desc" },
        take: 500,
        select: { id: true, shortCode: true, contactName: true, producedAt: true, productionPriceCents: true },
      }),
    );
    if (!orders.length) return { items: [] };
    const paid = new Set(
      (await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.settlementItem.findMany({
          where: { sourceType: "production_order", sourceId: { in: orders.map((o) => o.id) } },
          select: { sourceId: true },
        }),
      )).map((r) => r.sourceId),
    );
    const items = orders
      .filter((o) => !paid.has(o.id))
      .map((o) => ({
        id: o.id,
        shortCode: o.shortCode,
        contactName: o.contactName,
        producedAt: o.producedAt,
        valueCents: Number(o.productionPriceCents ?? 0n),
      }));
    return { items };
  }

  /**
   * Soma de peças do pedido: usa o roster (ficha técnica) se houver; fallback
   * pra soma dos qty dos items. Costureira recebe esse total × pricePerPiece.
   */
  private async totalPiecesInOrder(orderId: string): Promise<number> {
    const order = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findUnique({
        where: { id: orderId },
        include: { roster: { select: { qty: true } }, items: { select: { qty: true } } },
      }),
    );
    if (!order) return 0;
    const fromRoster = order.roster?.reduce((s, r) => s + (r.qty ?? 0), 0) ?? 0;
    if (fromRoster > 0) return fromRoster;
    return order.items?.reduce((s, it) => s + (it.qty ?? 0), 0) ?? 0;
  }

  /**
   * Cálculo do valor a pagar à costureira por uma OS. Usa pricePerPieceCents
   * da supplier × peças totais do roster (ou items). Retorna null se não tem
   * supplier atribuída OU se a supplier não tem preço cadastrado.
   */
  async computeProductionPriceCents(orderId: string, supplierId: string): Promise<number | null> {
    const s = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { pricePerPieceCents: true } }),
    );
    if (!s) return null;
    const perPiece = Number(s.pricePerPieceCents ?? 0n);
    if (perPiece <= 0) return null;
    const pieces = await this.totalPiecesInOrder(orderId);
    if (pieces <= 0) return null;
    return perPiece * pieces;
  }

  /**
   * Limite (%) de desconto que o vendedor pode aplicar sem autorização.
   * Lido da config do nicho gráfica em call_center_settings. 0 = exige sempre.
   * Owner e admin ignoram (autoridade total).
   */
  async maxOperatorDiscountPct(ctx: RequestContext): Promise<number> {
    if (ctx.isOrgAdmin || ctx.isPlatformAdmin) return 100;
    const orgId = ctx.orgId;
    if (!orgId) return 0;
    const cfg = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId: orgId }, select: { graficaMaxOperatorDiscountPct: true } }),
    ).catch(() => null);
    if (!cfg?.graficaMaxOperatorDiscountPct) return 0;
    const v = Number(cfg.graficaMaxOperatorDiscountPct);
    return isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  }

  /** Valida o código de desconto e devolve {amountCents, adminName}. */
  private async verifyDiscountAuth(ctx: RequestContext, requestId: string, code: string): Promise<{ amountCents: number; adminName: string }> {
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.findFirst({ where: { id: requestId, purpose: "production_discount" } }));
    if (!rec) throw new AppError(ErrorCode.NotFound, "Autorização não encontrada", 404);
    if (rec.usedAt) throw new AppError(ErrorCode.Conflict, "Código já utilizado", 409);
    if (rec.expiresAt.getTime() < Date.now()) throw new AppError(ErrorCode.ValidationFailed, "Código expirado", 400);
    if ((rec.attempts ?? 0) >= 5) throw new AppError(ErrorCode.ValidationFailed, "Tentativas esgotadas", 400);
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(String(code)).digest("hex");
    const ok = codeHash.length === rec.codeHash.length && timingSafeEqual(Buffer.from(codeHash), Buffer.from(rec.codeHash));
    if (!ok) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } }));
      throw new AppError(ErrorCode.ValidationFailed, "Código incorreto", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }));
    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: rec.adminMembershipId }, select: { user: { select: { name: true } } } }));
    return { amountCents: Number(rec.amountCents ?? 0n), adminName: admin?.user?.name ?? "autorizador" };
  }

  // ============================== TECIDO / INSUMOS (consumo de estoque) ==============================
  /** Define a lista de tecidos/insumos consumidos pelo pedido (produto × qtd). */
  async setFabrics(ctx: RequestContext, id: string, rows: Array<{ productId: string; qty: number }>) {
    this.requireOrg(ctx);
    const o = await this.getById(ctx, id);
    const clean = (rows ?? [])
      .map((r) => ({ productId: r.productId, qty: Math.max(0, Math.trunc(r.qty ?? 0)) }))
      .filter((r) => r.productId && r.qty > 0);
    // valida que os produtos pertencem à org (RLS já restringe, mas confirmamos existência)
    if (clean.length) {
      const found = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { id: { in: clean.map((r) => r.productId) }, deletedAt: null }, select: { id: true } }));
      const ok = new Set(found.map((p) => p.id));
      for (const r of clean) if (!ok.has(r.productId)) throw new AppError(ErrorCode.ValidationFailed, "Produto de tecido inválido", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.productionOrderFabric.deleteMany({ where: { orderId: id } });
      if (clean.length) await tx.productionOrderFabric.createMany({ data: clean.map((r) => ({ organizationId: o.organizationId, orderId: id, productId: r.productId, qty: r.qty })) });
    });
    return this.getById(ctx, id);
  }

  /** Baixa do estoque (loja do pedido) o tecido listado. Idempotente via fabric_consumed_at. */
  private async consumeFabric(ctx: RequestContext, order: any) {
    const fabrics = (order.fabrics ?? []) as Array<{ productId: string; qty: number }>;
    if (!fabrics.length) return;
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const fresh = await tx.productionOrder.findFirst({ where: { id: order.id }, select: { fabricConsumedAt: true } });
      if (fresh?.fabricConsumedAt) return; // já consumido
      for (const f of fabrics) {
        if (!f.productId || f.qty <= 0) continue;
        const after = await applyStoreStockDelta(tx, order.organizationId, f.productId, order.storeId ?? null, -Math.abs(f.qty));
        await tx.stockMovement.create({ data: { organizationId: order.organizationId, storeId: order.storeId ?? null, productId: f.productId, kind: "adjustment", qty: -Math.abs(f.qty), qtyAfter: after, reason: `Consumo de produção ${order.shortCode ?? ""}`.trim(), referenceType: "production_order", referenceId: order.id, createdByUserId: ctx.userId ?? null } });
      }
      await tx.productionOrder.update({ where: { id: order.id }, data: { fabricConsumedAt: new Date() } });
    });
  }

  /** Adiciona um arquivo (do cliente ou arte). Arte → marca "enviada" e notifica o cliente. */
  async addFile(ctx: RequestContext, id: string, input: { kind: "client_asset" | "art"; url: string; name?: string | null; uploadedBy?: "staff" | "customer" }) {
    this.requireOrg(ctx);
    const o = await this.getById(ctx, id);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const version = input.kind === "art" ? (await tx.productionOrderFile.count({ where: { orderId: id, kind: "art" } })) + 1 : 1;
      const file = await tx.productionOrderFile.create({ data: { organizationId: o.organizationId, orderId: id, kind: input.kind, url: input.url, name: input.name ?? null, version, uploadedBy: input.uploadedBy ?? "staff" } });
      if (input.kind === "client_asset" && o.artStatus === "aguardando_arquivos") {
        await tx.productionOrder.update({ where: { id }, data: { artStatus: "arquivos_recebidos" } });
      }
      if (input.kind === "art") {
        await tx.productionOrder.update({ where: { id }, data: { artStatus: "enviada", status: o.status === "novo" ? "arte" : o.status } });
      }
      return file;
    }).then(async (file) => {
      if (input.kind === "art") await this.notifyCustomer(o, "arte").catch(() => undefined);
      return file;
    });
  }

  /** Cliente (portal) ou operador aprova/reprova a arte. Reprovar exige comentário. */
  async reviewArt(ctx: RequestContext, id: string, input: { decision: "approved" | "rejected"; comment?: string | null; reviewer?: "customer" | "staff" }) {
    this.requireOrg(ctx);
    const o = await this.getById(ctx, id);
    if (input.decision === "rejected" && !(input.comment ?? "").trim()) throw new AppError(ErrorCode.ValidationFailed, "Descreva o que precisa ajustar na arte", 400);
    const lastArt = (o.files as any[]).find((f) => f.kind === "art");
    const result = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.productionArtReview.create({ data: { organizationId: o.organizationId, orderId: id, fileId: lastArt?.id ?? null, decision: input.decision, comment: input.comment ?? null, reviewer: input.reviewer ?? "customer" } });
      const data: any = { artStatus: input.decision === "approved" ? "aprovada" : "reprovada" };
      // arte aprovada libera a produção (se ainda não passou)
      if (input.decision === "approved" && ["novo", "arte"].includes(o.status)) data.status = "costura";
      await tx.productionOrder.update({ where: { id }, data });
      return tx.productionOrder.findFirst({ where: { id }, include: { reviews: { orderBy: { createdAt: "desc" } } } });
    });
    // aprovou → manda a mensagem pós-aprovação (medidas + Pix + prazo), best-effort
    if (input.decision === "approved") void this.sendPostApproval(o);
    return result;
  }

  /** Quadro do Design: pedidos não finalizados/cancelados, agrupados por art_status, com urgência do prazo. */
  async designKanban(ctx: RequestContext) {
    this.requireOrg(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.productionOrder.findMany({
        where: { status: { notIn: ["finalizado", "cancelado"] } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, shortCode: true, contactName: true, status: true, artStatus: true, dueDate: true, totalCents: true },
        take: 500,
      }),
    );
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cards = rows.map((r) => {
      let urgency: "ok" | "soon" | "urgent" = "ok";
      let daysLeft: number | null = null;
      if (r.dueDate) {
        daysLeft = Math.ceil((new Date(r.dueDate).getTime() - today.getTime()) / 86400_000);
        urgency = daysLeft <= 1 ? "urgent" : daysLeft <= 3 ? "soon" : "ok";
      }
      return { id: r.id, shortCode: r.shortCode, contactName: r.contactName, status: r.status, artStatus: r.artStatus, dueDate: r.dueDate, daysLeft, urgency, totalCents: String(r.totalCents) };
    });
    const columns = ["aguardando_arquivos", "arquivos_recebidos", "em_producao", "enviada", "reprovada", "aprovada"];
    const byColumn: Record<string, any[]> = {};
    for (const c of columns) byColumn[c] = cards.filter((x) => x.artStatus === c);
    return { columns, byColumn };
  }

  async remove(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.deleteMany({ where: { id } }));
    return { ok: true };
  }

  // ============================== NOTA FISCAL (sob demanda) ==============================
  /** Pedidos que pediram NF e ainda não tiveram a nota emitida (aba "Notas fiscais"). */
  async nfPending(ctx: RequestContext): Promise<any> {
    this.requireOrg(ctx);
    const sel = { id: true, shortCode: true, contactName: true, contactPhone: true, contactEmail: true, fiscalCpf: true, fiscalAddress: true, totalCents: true, status: true, paymentStatus: true, nfUrl: true, nfKey: true, nfNumber: true, nfIssuedAt: true, nfAuthorizedBy: true, createdAt: true } as const;
    const [pending, generated] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findMany({ where: { needsInvoice: true, nfIssuedAt: null }, orderBy: { createdAt: "asc" }, select: sel })),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findMany({ where: { needsInvoice: true, nfIssuedAt: { not: null } }, orderBy: { nfIssuedAt: "desc" }, take: 100, select: sel })),
    ]);
    return { pending, generated };
  }

  /** Anexa a NF ao pedido. Exige os dados fiscais completos do cliente. */
  async attachNf(ctx: RequestContext, id: string, url: string) {
    this.requireOrg(ctx);
    const o = await this.getById(ctx, id);
    const missing: string[] = [];
    if (!(o.contactName ?? "").trim()) missing.push("nome");
    if (!(o.fiscalCpf ?? "").trim()) missing.push("CPF");
    if (!(o.contactPhone ?? "").trim()) missing.push("telefone");
    if (missing.length) throw new AppError(ErrorCode.ValidationFailed, `Faltam dados do cliente para a NF: ${missing.join(", ")}`, 400);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.update({ where: { id }, data: { nfUrl: url, nfIssuedAt: new Date() } }));
    // avisa o cliente que a NF está disponível (best-effort)
    try {
      await this.notifications.notify({
        organizationId: o.organizationId, storeId: o.storeId ?? o.organizationId, customerId: o.customerId ?? null,
        whatsappPhone: o.contactPhone ?? null, email: o.contactEmail ?? null,
        subject: `Nota fiscal do pedido ${o.shortCode ?? ""}`,
        text: `Olá! A nota fiscal do seu pedido ${o.shortCode ?? ""} está disponível: ${url}`,
        templateCode: "production_nf", media: { url, fileName: `NF-${o.shortCode ?? "pedido"}.pdf`, mediatype: "document" },
      });
    } catch { /* best-effort */ }
    return this.getById(ctx, id);
  }

  // ============================== PORTAL DO CLIENTE ==============================
  private sysCtx(orgId: string): RequestContext { return { orgId, isOrgAdmin: true } as RequestContext; }
  private async assertOwner(orgId: string, customerId: string, id: string) {
    const o = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.productionOrder.findFirst({ where: { id, organizationId: orgId, customerId }, select: { id: true } }));
    if (!o) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
  }
  /** Pedidos do cliente logado (portal). */
  async portalList(orgId: string, customerId: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findMany({ where: { organizationId: orgId, customerId }, orderBy: { createdAt: "desc" }, include: { items: true, files: { orderBy: { createdAt: "desc" } }, reviews: { orderBy: { createdAt: "desc" } } }, take: 100 }),
    );
  }
  async portalGet(orgId: string, customerId: string, id: string) {
    await this.assertOwner(orgId, customerId, id);
    return this.getById(this.sysCtx(orgId), id);
  }
  /** Cliente sobe um arquivo seu (logo etc.). */
  async portalAddFile(orgId: string, customerId: string, id: string, input: { url: string; name?: string | null }) {
    await this.assertOwner(orgId, customerId, id);
    return this.addFile(this.sysCtx(orgId), id, { kind: "client_asset", url: input.url, name: input.name ?? null, uploadedBy: "customer" });
  }
  /** Cliente aprova/reprova a arte (reprovar exige comentário). */
  async portalReviewArt(orgId: string, customerId: string, id: string, input: { decision: "approved" | "rejected"; comment?: string | null }) {
    await this.assertOwner(orgId, customerId, id);
    return this.reviewArt(this.sysCtx(orgId), id, { decision: input.decision, comment: input.comment ?? null, reviewer: "customer" });
  }

  /** Cliente preenche/atualiza a lista padronizada do pedido (uniforme: nome,
   *  número, tamanho, qtd). Substitui o roster anterior. Bloqueado depois do
   *  pedido sair de "novo/arte" (já entrou em produção, RH não muda mais). */
  async portalSetRoster(orgId: string, customerId: string, id: string, rows: Array<{ playerName: string; number?: string | null; size?: string | null; qty?: number; notes?: string | null; modelKey?: string | null }>) {
    await this.assertOwner(orgId, customerId, id);
    const o = await this.getById(this.sysCtx(orgId), id);
    if (!["novo", "arte"].includes(o.status)) {
      throw new AppError(ErrorCode.Conflict, "Pedido já saiu da etapa de arte — fale com a loja pra ajustar a lista.", 409);
    }
    return this.setRoster(this.sysCtx(orgId), id, rows);
  }

  /** Cliente assina a OS na finalização (PNG do canvas, sem certificado). */
  async portalSignOrder(orgId: string, customerId: string, id: string, signatureDataUrl: string, ip: string | null) {
    await this.assertOwner(orgId, customerId, id);
    return this.saveCustomerSignature(this.sysCtx(orgId), id, signatureDataUrl, ip);
  }

  private async notifyCustomer(o: any, kind: "pronto" | "arte" | "producao" | "entrega") {
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: o.organizationId }, select: { name: true, slug: true } }));
    const first = (o.contactName || "Cliente").split(" ")[0];
    const portal = `${orgBaseUrl(org?.slug)}/c`;
    // arte: anexa a imagem da última arte e convida a aprovar PELO WHATSAPP (a IA
    // aprova ao receber o "sim") — ou pelo portal.
    let media: { url: string; fileName?: string; mediatype: "image" | "document" } | undefined;
    if (kind === "arte") {
      const arts = ((o.files as any[]) ?? []).filter((f) => f.kind === "art").sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
      const last = arts[0];
      if (last?.url) {
        const isImg = /\.(png|jpe?g|webp|gif)$/i.test(last.url);
        media = { url: last.url, fileName: last.name ?? `arte-${o.shortCode ?? "pedido"}`, mediatype: isImg ? "image" : "document" };
      }
    }
    const loja = org?.name ?? "nossa loja";
    const cod = o.shortCode ?? "";
    // lembrete de cobrança do SALDO: em "pronto"/"entrega", se o pagamento não está
    // quitado, calcula o que falta e informa (com a chave Pix da empresa).
    let saldoLine = "";
    if ((kind === "entrega" || kind === "pronto") && o.paymentStatus !== "paid") {
      const total = Number(o.totalCents ?? 0);
      const pago = o.paymentStatus === "partial" ? Number(o.downPaymentCents ?? 0) : 0;
      const saldo = Math.max(0, total - pago);
      if (saldo > 0) {
        const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const cfg = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.callCenterSettings.findFirst({ where: { organizationId: o.organizationId }, select: { graficaPixKey: true } })).catch(() => null);
        saldoLine = `\n\n💰 Falta o saldo de *${brl(saldo)}*${pago > 0 ? ` (sinal de ${brl(pago)} já pago)` : ""}.`
          + (cfg?.graficaPixKey ? `\n💸 *Pix:* ${cfg.graficaPixKey}\nEnvie o comprovante por aqui assim que pagar. 🙂` : "");
      }
    }
    const text =
      kind === "pronto" ? `Oi, ${first}! 🎉 Seu pedido *${cod}* na ${loja} está *pronto*!${o.delivery ? " Em breve combinamos a entrega." : " Pode vir retirar. 😊"}${saldoLine}`
      : kind === "producao" ? `Oi, ${first}! 🧵 Seu pedido *${cod}* na ${loja} *entrou em produção*. Já já tem novidade — acompanhe pelo portal: ${portal}`
      : kind === "entrega" ? `Oi, ${first}! 🚚 Seu pedido *${cod}* ${o.delivery ? "*saiu para entrega*" : "está *pronto para retirada*"}!${o.delivery ? " Fique de olho que já chega. 😉" : " Pode vir buscar. 😊"}${saldoLine}`
      : `Oi, ${first}! 🎨 Aqui está a arte do seu pedido *${cod}*.\n\nSe ficou *do jeito que você quer*, responda *APROVAR* por aqui que já seguimos pra produção. Se precisar mudar algo, é só me dizer o que ajustar.\n\nTambém dá pra ver e aprovar pelo portal: ${portal}`;
    const subject =
      kind === "pronto" ? `Seu pedido está pronto — ${org?.name ?? ""}`
      : kind === "producao" ? `Seu pedido entrou em produção — ${org?.name ?? ""}`
      : kind === "entrega" ? `Seu pedido ${o.delivery ? "saiu para entrega" : "está pronto para retirada"} — ${org?.name ?? ""}`
      : `Arte para aprovação — ${org?.name ?? ""}`;
    const templateCode =
      kind === "pronto" ? "production_ready"
      : kind === "producao" ? "production_started"
      : kind === "entrega" ? "production_delivery"
      : "production_art";
    await this.notifications.notify({
      organizationId: o.organizationId, storeId: o.storeId ?? o.organizationId, customerId: o.customerId ?? null,
      whatsappPhone: o.contactPhone ?? null, email: o.contactEmail ?? null,
      subject, text, templateCode,
      ...(media ? { media } : {}),
    } as any);
  }

  /** Mensagem pós-aprovação da arte (gráfica): tabela de medidas + chave Pix +
   *  prazo de entrega. Lê a config da empresa (call_center_settings). Best-effort. */
  private async sendPostApproval(o: any) {
    try {
      const cfg = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.callCenterSettings.findFirst({ where: { organizationId: o.organizationId }, select: { graficaPixKey: true, graficaSizeChart: true, graficaSizeChartUrl: true, graficaLeadDays: true, graficaDownPaymentPct: true } }),
      );
      // só dispara a mensagem rica se a empresa configurou algo de gráfica
      if (!cfg || (!cfg.graficaPixKey && !cfg.graficaSizeChart && !cfg.graficaSizeChartUrl)) return;
      const first = (o.contactName || "Cliente").split(" ")[0];
      const deadline = o.dueDate
        ? new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })
        : new Date(Date.now() + (cfg.graficaLeadDays ?? 7) * 86400_000).toLocaleDateString("pt-BR");
      // política de pagamento: 100% = total à vista; <100% = sinal agora + saldo na entrega
      const total = Number(o.totalCents ?? 0);
      const pct = Math.min(100, Math.max(1, cfg.graficaDownPaymentPct ?? 50));
      const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      let pagamentoLinha = "";
      if (total > 0) {
        if (pct >= 100) pagamentoLinha = `\n💰 *Pagamento:* total de ${brl(total)}.`;
        else {
          const sinal = Math.round(total * pct / 100);
          pagamentoLinha = `\n💰 *Pagamento:* sinal de ${pct}% = *${brl(sinal)}* agora, e o saldo de ${brl(total - sinal)} na entrega.`;
        }
      }
      const lines = [`Oi, ${first}! ✅ Arte aprovada — já vamos pra produção.`];
      if (cfg.graficaSizeChart) lines.push(`\n📏 *Tabela de medidas:*\n${cfg.graficaSizeChart}`);
      if (pagamentoLinha) lines.push(pagamentoLinha);
      if (cfg.graficaPixKey) lines.push(`\n💸 *Chave Pix:* ${cfg.graficaPixKey}\nEnvie o comprovante por aqui assim que pagar. 🙂`);
      lines.push(`\n🚚 *Prazo de entrega:* até ${deadline}.`);
      const media = cfg.graficaSizeChartUrl
        ? { url: cfg.graficaSizeChartUrl, fileName: "tabela-de-medidas", mediatype: (/\.(png|jpe?g|webp)$/i.test(cfg.graficaSizeChartUrl) ? "image" : "document") as "image" | "document" }
        : undefined;
      await this.notifications.notify({
        organizationId: o.organizationId, storeId: o.storeId ?? o.organizationId, customerId: o.customerId ?? null,
        whatsappPhone: o.contactPhone ?? null, email: o.contactEmail ?? null,
        subject: "Arte aprovada — próximos passos", text: lines.join("\n"), templateCode: "production_approved",
        ...(media ? { media } : {}),
      } as any);
    } catch (e: any) {
      this.logger.warn(`sendPostApproval falhou: ${e?.message}`);
    }
  }

  /**
   * Gráfica: o cliente mandou um COMPROVANTE (imagem/PDF) pelo WhatsApp depois de
   * aprovar a arte. Anexa ao pedido aberto aguardando pagamento, marca "comprovante
   * recebido" (a baixa do pagamento continua MANUAL — a equipe confere) e confirma
   * ao cliente. Chamado pelo webhook (contexto de sistema). Retorna true se casou.
   */
  async capturePaymentProofFromWhatsapp(input: { organizationId: string; storeId?: string | null; customerId?: string | null; mediaUrl: string; mediaMime?: string | null; fileName?: string | null }): Promise<boolean> {
    if (!input.customerId || !input.mediaUrl) return false;
    const mime = (input.mediaMime ?? "").toLowerCase();
    const isProofMedia = mime.startsWith("image/") || mime === "application/pdf";
    if (!isProofMedia) return false;
    // só gráfica/uniformes
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: input.organizationId }, select: { niche: true } })).catch(() => null);
    if ((org?.niche ?? "").toLowerCase() !== "grafica") return false;
    // pedido aberto aguardando pagamento (após a arte): mais recente
    const order = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.productionOrder.findFirst({
      where: { organizationId: input.organizationId, customerId: input.customerId, status: { notIn: ["finalizado", "cancelado"] }, paymentStatus: { not: "paid" }, artStatus: { in: ["aprovada", "enviada"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, shortCode: true, storeId: true, contactName: true, contactPhone: true, contactEmail: true, customerId: true },
    })).catch(() => null);
    if (!order) return false;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const version = (await tx.productionOrderFile.count({ where: { orderId: order.id, kind: "payment_proof" } })) + 1;
      await tx.productionOrderFile.create({ data: { organizationId: input.organizationId, orderId: order.id, kind: "payment_proof", url: input.mediaUrl, name: input.fileName ?? `comprovante-${version}`, version, uploadedBy: "customer" } });
      await tx.productionOrder.update({ where: { id: order.id }, data: { paymentProofUrl: input.mediaUrl, paymentProofAt: new Date() } });
    });
    // confirma ao cliente (best-effort) — não dá baixa automática
    try {
      const first = (order.contactName || "Cliente").split(" ")[0];
      await this.notifications.notify({
        organizationId: input.organizationId, storeId: order.storeId ?? input.organizationId, customerId: order.customerId ?? null,
        whatsappPhone: order.contactPhone ?? null, email: order.contactEmail ?? null,
        subject: "Comprovante recebido", text: `Oi, ${first}! ✅ Recebemos seu comprovante do pedido *${order.shortCode ?? ""}*. Vamos conferir o pagamento e já te confirmamos por aqui. 🙂`,
        templateCode: "production_payment_proof",
      });
    } catch { /* best-effort */ }
    this.logger.log(`comprovante recebido: pedido=${order.id} org=${input.organizationId}`);
    return true;
  }

  /** Relatório financeiro da gráfica: faturamento, recebido, a receber + funil de orçamentos. */
  async financeiro(ctx: RequestContext, opts?: { start?: string; end?: string }) {
    this.requireOrg(ctx);
    const from = opts?.start ? new Date(opts.start + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts?.end ? new Date(opts.end + "T23:59:59Z") : new Date();
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const orders = await tx.productionOrder.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { status: true, paymentStatus: true, totalCents: true, downPaymentCents: true },
        take: 5000,
      });
      const ativos = orders.filter((o) => o.status !== "cancelado");
      let faturamento = 0, recebido = 0;
      const porStatus = new Map<string, { count: number; valueCents: number }>();
      for (const o of ativos) {
        const total = Number(o.totalCents ?? 0);
        const down = Number(o.downPaymentCents ?? 0);
        faturamento += total;
        recebido += o.paymentStatus === "paid" ? total : o.paymentStatus === "partial" ? Math.min(down, total) : 0;
        const cur = porStatus.get(o.status) ?? { count: 0, valueCents: 0 };
        cur.count++; cur.valueCents += total; porStatus.set(o.status, cur);
      }
      const aReceber = Math.max(0, faturamento - recebido);
      // funil de orçamentos
      const quotes = await tx.quote.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { status: true, totalCents: true, createdByUserId: true } });
      const quotesTotal = quotes.length;
      const quotesConvert = quotes.filter((q) => q.status === "converted").length;
      const quotesViaIa = quotes.filter((q) => !q.createdByUserId).length;
      const quotesValueCents = quotes.reduce((s, q) => s + Number(q.totalCents ?? 0), 0);
      return {
        from, to,
        producao: {
          pedidos: ativos.length,
          cancelados: orders.length - ativos.length,
          faturamentoCents: faturamento,
          recebidoCents: recebido,
          aReceberCents: aReceber,
          porStatus: [...porStatus.entries()].map(([status, v]) => ({ status, label: STATUS_LABEL[status] ?? status, count: v.count, valueCents: v.valueCents })),
        },
        orcamentos: {
          total: quotesTotal,
          convertidos: quotesConvert,
          viaIa: quotesViaIa,
          taxaConversao: quotesTotal > 0 ? Math.round((quotesConvert / quotesTotal) * 100) : 0,
          valorTotalCents: quotesValueCents,
        },
      };
    });
  }

  /** Exporta o relatório financeiro em CSV ou PDF. */
  async financeiroExport(ctx: RequestContext, opts: { start?: string; end?: string; format: "csv" | "pdf" }): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const fin = await this.financeiro(ctx, { start: opts.start, end: opts.end });
    const p = fin.producao; const o = fin.orcamentos;
    const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    const periodo = `${new Date(fin.from).toLocaleDateString("pt-BR")} a ${new Date(fin.to).toLocaleDateString("pt-BR")}`;
    const stamp = new Date().toISOString().slice(0, 10);
    if (opts.format === "csv") {
      const rows: string[] = [];
      rows.push("Relatorio financeiro da grafica");
      rows.push(`Periodo;${periodo}`);
      rows.push("");
      rows.push("Indicador;Valor");
      rows.push(`Pedidos;${p.pedidos}`);
      rows.push(`Cancelados;${p.cancelados}`);
      rows.push(`Faturamento (R$);${money(p.faturamentoCents)}`);
      rows.push(`Recebido (R$);${money(p.recebidoCents)}`);
      rows.push(`A receber (R$);${money(p.aReceberCents)}`);
      rows.push("");
      rows.push("Etapa;Pedidos;Valor (R$)");
      for (const s of p.porStatus) rows.push(`${s.label};${s.count};${money(s.valueCents)}`);
      rows.push("");
      rows.push("Orcamentos;Valor");
      rows.push(`Total;${o.total}`);
      rows.push(`Convertidos em pedido;${o.convertidos}`);
      rows.push(`Taxa de conversao (%);${o.taxaConversao}`);
      rows.push(`Criados pela IA;${o.viaIa}`);
      rows.push(`Valor total orcado (R$);${money(o.valorTotalCents)}`);
      const buffer = Buffer.from("﻿" + rows.join("\r\n"), "utf8"); // BOM p/ Excel
      return { buffer, filename: `financeiro-grafica-${stamp}.csv`, contentType: "text/csv; charset=utf-8" };
    }
    // PDF
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      pdf.on("data", (c) => chunks.push(c as Buffer));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      const M = 48, W = pdf.page.width, right = W - M;
      pdf.font("Helvetica-Bold").fontSize(18).fillColor("#111").text("Financeiro da gráfica", M, 48);
      pdf.font("Helvetica").fontSize(10).fillColor("#555").text(`Período: ${periodo}`);
      pdf.moveDown(1);
      const kv = (k: string, v: string, color = "#111") => { pdf.font("Helvetica").fontSize(11).fillColor("#555").text(k, M, undefined as any, { continued: true }); pdf.font("Helvetica-Bold").fillColor(color).text("   " + v, { align: "right" }); };
      kv("Pedidos", String(p.pedidos));
      kv("Cancelados", String(p.cancelados));
      kv("Faturamento", `R$ ${money(p.faturamentoCents)}`);
      kv("Recebido", `R$ ${money(p.recebidoCents)}`, "#0a0");
      kv("A receber", `R$ ${money(p.aReceberCents)}`, "#b80");
      pdf.moveDown(0.8); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.6);
      pdf.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("Pedidos por etapa");
      pdf.moveDown(0.3);
      for (const s of p.porStatus) kv(`${s.label} (${s.count})`, `R$ ${money(s.valueCents)}`);
      pdf.moveDown(0.8); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.6);
      pdf.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("Orçamentos");
      pdf.moveDown(0.3);
      kv("Total", String(o.total));
      kv("Viraram pedido", String(o.convertidos));
      kv("Taxa de conversão", `${o.taxaConversao}%`);
      kv("Criados pela IA", String(o.viaIa));
      kv("Valor total orçado", `R$ ${money(o.valorTotalCents)}`);
      pdf.moveDown(1.5); pdf.font("Helvetica").fontSize(8).fillColor("#999").text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, M, undefined as any, { align: "right" });
      pdf.end();
    });
    return { buffer, filename: `financeiro-grafica-${stamp}.pdf`, contentType: "application/pdf" };
  }

  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }

  // ===================== CATÁLOGO DA GRÁFICA (niche='grafica') =====================
  // Tabela de VALORES (preço por faixa de quantidade) + tabela de MEDIDAS.
  // Tudo escopado por org e guardado pelo nicho — não afeta ótica/genérico.

  private async orgNiche(orgId: string): Promise<string> {
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { niche: true } })).catch(() => null);
    return (org?.niche ?? "").toLowerCase();
  }
  private async requireGrafica(ctx: RequestContext) {
    this.requireOrg(ctx);
    if (ctx.isPlatformAdmin) return;
    if ((await this.orgNiche(ctx.orgId!)) !== "grafica") {
      throw new AppError(ErrorCode.Forbidden, "Recurso exclusivo do nicho gráfica", 403);
    }
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /** Escolhe o preço unitário (centavos) da faixa correspondente à quantidade. */
  priceForQty(tiers: Array<{ minQty: number; priceCents: number }>, qty: number): number | null {
    const sorted = [...(tiers ?? [])].filter((t) => t && t.minQty > 0).sort((a, b) => a.minQty - b.minQty);
    if (!sorted.length) return null;
    let chosen = sorted[0]!.priceCents;
    for (const t of sorted) if (qty >= t.minQty) chosen = t.priceCents;
    return chosen;
  }

  /** Busca p/ o pedido de gráfica: junta a TABELA DE VALORES (com faixas) + produtos do PDV. */
  async searchCatalog(ctx: RequestContext, q: string): Promise<any> {
    this.requireOrg(ctx);
    const term = (q ?? "").trim();
    const like = term ? { name: { contains: term, mode: "insensitive" as const } } : {};
    const [tabela, prods, charts] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaPriceItem.findMany({ where: { active: true, ...like }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 25 })).catch(() => [] as any[]),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { isActive: true, deletedAt: null, ...like }, orderBy: { name: "asc" }, take: 25, select: { id: true, name: true, category: true, priceCashCents: true } })).catch(() => [] as any[]),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaSizeChart.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }], select: { name: true, rows: true } })).catch(() => [] as any[]),
    ]);
    // tamanhos distintos das grades (na ordem em que aparecem) p/ o modal de quantidades
    const sizes: string[] = [];
    for (const c of charts as any[]) for (const r of (Array.isArray(c.rows) ? c.rows : [])) { const s = String(r?.size ?? "").trim(); if (s && !sizes.includes(s)) sizes.push(s); }
    return {
      sizes: sizes.length ? sizes : ["P", "M", "G", "GG", "XG"],
      items: [
        ...(tabela as any[]).map((t) => ({ source: "tabela" as const, id: t.id, name: t.name, category: t.category, unitLabel: t.unitLabel, tiers: Array.isArray(t.tiers) ? t.tiers : [] })),
        ...(prods as any[]).map((p) => ({ source: "pdv" as const, id: p.id, name: p.name, category: p.category, priceCents: p.priceCashCents ?? 0 })),
      ],
    };
  }

  async listCatalog(ctx: RequestContext) {
    this.requireOrg(ctx);
    // só gráfica usa; outras orgs recebem vazio (sem erro, pra UI condicional)
    if (!ctx.isPlatformAdmin && (await this.orgNiche(ctx.orgId!)) !== "grafica") {
      return { priceItems: [], sizeCharts: [] };
    }
    const [priceItems, sizeCharts] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaPriceItem.findMany({ where: {}, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaSizeChart.findMany({ where: {}, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })),
    ]);
    return { priceItems, sizeCharts };
  }

  async upsertPriceItem(ctx: RequestContext, input: { id?: string | null; category?: string | null; name: string; unitLabel?: string | null; tiers: Array<{ minQty: number; priceCents: number }>; sortOrder?: number; active?: boolean }) {
    await this.requireGrafica(ctx); this.requireAdmin(ctx);
    const tiers = (input.tiers ?? []).filter((t) => t && Number(t.minQty) > 0 && Number(t.priceCents) >= 0)
      .map((t) => ({ minQty: Math.trunc(Number(t.minQty)), priceCents: Math.round(Number(t.priceCents)) }))
      .sort((a, b) => a.minQty - b.minQty);
    const data = { category: input.category?.trim() || null, name: input.name.trim(), unitLabel: input.unitLabel?.trim() || null, tiers: tiers as any, sortOrder: input.sortOrder ?? 0, active: input.active ?? true };
    if (input.id) {
      return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaPriceItem.update({ where: { id: input.id! }, data }));
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaPriceItem.create({ data: { organizationId: ctx.orgId!, ...data } }));
  }
  async deletePriceItem(ctx: RequestContext, id: string) {
    await this.requireGrafica(ctx); this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaPriceItem.deleteMany({ where: { id } }));
    return { ok: true };
  }

  async upsertSizeChart(ctx: RequestContext, input: { id?: string | null; name: string; rows: Array<{ size: string; comprimento?: string | null; largura?: string | null }>; sortOrder?: number; active?: boolean }) {
    await this.requireGrafica(ctx); this.requireAdmin(ctx);
    const rows = (input.rows ?? []).filter((r) => r && String(r.size ?? "").trim())
      .map((r) => ({ size: String(r.size).trim(), comprimento: (r.comprimento ?? "").toString().trim() || null, largura: (r.largura ?? "").toString().trim() || null }));
    const data = { name: input.name.trim(), rows: rows as any, sortOrder: input.sortOrder ?? 0, active: input.active ?? true };
    if (input.id) {
      return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaSizeChart.update({ where: { id: input.id! }, data }));
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaSizeChart.create({ data: { organizationId: ctx.orgId!, ...data } }));
  }
  async deleteSizeChart(ctx: RequestContext, id: string) {
    await this.requireGrafica(ctx); this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.graficaSizeChart.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /** Aplica a tabela 2025 (planilhas do Yuri): upsert por nome — preserva itens extras. */
  async seedDefault2025(ctx: RequestContext) {
    await this.requireGrafica(ctx); this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const mk = (vals: number[]) => [1, 3, 10, 15, 20, 30].map((q, i) => ({ minQty: q, priceCents: vals[i]! }));
    const items: Array<{ category: string; name: string; unitLabel: string; tiers: any[] }> = [
      { category: "Camisas", name: "Camisa Malha NO Liso", unitLabel: "camisa", tiers: mk([7500, 5500, 5200, 5000, 4700, 4500]) },
      { category: "Camisas", name: "Camisa Malha NO Premium", unitLabel: "camisa", tiers: mk([8000, 6000, 5700, 5500, 5200, 5000]) },
      { category: "Camisas", name: "Camisa Malha NO Gold", unitLabel: "camisa", tiers: mk([12000, 12000, 9600, 9400, 9200, 9000]) },
      { category: "Camisas", name: "Camisa UV", unitLabel: "camisa", tiers: mk([12000, 10000, 9600, 9400, 9200, 9000]) },
      { category: "Camisas", name: "Camisa Manga Longa", unitLabel: "camisa", tiers: mk([8500, 6500, 6200, 6000, 5700, 5500]) },
      { category: "Camisas", name: "Camisa Polo", unitLabel: "camisa", tiers: mk([8500, 6500, 6200, 6000, 5700, 5500]) },
      { category: "Camisas", name: "Camisa Basquete", unitLabel: "camisa", tiers: mk([7500, 5500, 5200, 5000, 4700, 4500]) },
      { category: "Regatas e shorts", name: "Regata ou Machão", unitLabel: "regata", tiers: mk([7000, 5000, 4700, 4500, 4200, 4000]) },
      { category: "Regatas e shorts", name: "Short", unitLabel: "short", tiers: mk([5000, 4000, 3700, 3500, 3200, 3000]) },
      { category: "Regatas e shorts", name: "MalhaPP (regata)", unitLabel: "regata", tiers: mk([7000, 5000, 4700, 4500, 4200, 4000]) },
      { category: "Coletes", name: "Colete Dupla Face", unitLabel: "colete", tiers: mk([8000, 7000, 6700, 6500, 6200, 6000]) },
      { category: "Conjuntos", name: "Conjunto NO Liso", unitLabel: "conjunto", tiers: mk([10000, 8500, 8200, 8000, 7700, 7500]) },
      { category: "Conjuntos", name: "Conjunto NO Premium", unitLabel: "conjunto", tiers: mk([11000, 9000, 8700, 8500, 8200, 8000]) },
      { category: "Conjuntos", name: "Conjunto Gold", unitLabel: "conjunto", tiers: mk([20000, 15500, 13000, 12500, 12000, 11500]) },
      { category: "Conjuntos", name: "Conjunto Regata ou Machão", unitLabel: "conjunto", tiers: mk([9000, 8000, 7700, 7500, 7200, 7000]) },
      { category: "Conjuntos", name: "Conjunto Dupla Face", unitLabel: "conjunto", tiers: mk([10000, 9000, 8700, 8500, 8200, 8000]) },
      { category: "Conjuntos", name: "Conjunto Basquete", unitLabel: "conjunto", tiers: mk([10000, 8500, 8200, 8000, 7700, 7500]) },
      { category: "Conjuntos", name: "Conjunto Manga Longa", unitLabel: "conjunto", tiers: mk([11000, 10000, 9700, 9500, 9200, 9000]) },
      { category: "Conjuntos", name: "Conjunto Polo", unitLabel: "conjunto", tiers: mk([11000, 10000, 9700, 9500, 9200, 9000]) },
    ];
    const charts: Array<{ name: string; rows: any[] }> = [
      { name: "Masculina", rows: [["P", "74cm", "50cm"], ["M", "76cm", "52cm"], ["G", "78cm", "55cm"], ["GG", "80cm", "58cm"], ["XG", "82cm", "61cm"]].map(([size, comprimento, largura]) => ({ size, comprimento, largura })) },
      { name: "Babylook", rows: [["P", "62cm", "46cm"], ["M", "64cm", "48cm"], ["G", "66cm", "52cm"], ["GG", "66cm", "55cm"], ["XG", "70cm", "58cm"]].map(([size, comprimento, largura]) => ({ size, comprimento, largura })) },
      { name: "Infantil", rows: [["P", "74cm", "50cm"], ["PP", "66cm", "46cm"], ["10 anos", "62cm", "43cm"], ["8 anos", "58cm", "40cm"], ["6 anos", "56cm", "38cm"], ["3 anos", "49cm", "34cm"]].map(([size, comprimento, largura]) => ({ size, comprimento, largura })) },
      { name: "Especiais", rows: [["G1", "86cm", "64cm"], ["G2", "88cm", "68cm"], ["G3", "88cm", "72cm"], ["G4", "96cm", "76cm"]].map(([size, comprimento, largura]) => ({ size, comprimento, largura })) },
    ];
    let priceCount = 0, chartCount = 0;
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const ex = await tx.graficaPriceItem.findFirst({ where: { organizationId: orgId, name: it.name }, select: { id: true } });
        if (ex) await tx.graficaPriceItem.update({ where: { id: ex.id }, data: { category: it.category, unitLabel: it.unitLabel, tiers: it.tiers as any, sortOrder: i } });
        else await tx.graficaPriceItem.create({ data: { organizationId: orgId, category: it.category, name: it.name, unitLabel: it.unitLabel, tiers: it.tiers as any, sortOrder: i } });
        priceCount++;
      }
      for (let i = 0; i < charts.length; i++) {
        const c = charts[i]!;
        const ex = await tx.graficaSizeChart.findFirst({ where: { organizationId: orgId, name: c.name }, select: { id: true } });
        if (ex) await tx.graficaSizeChart.update({ where: { id: ex.id }, data: { rows: c.rows as any, sortOrder: i } });
        else await tx.graficaSizeChart.create({ data: { organizationId: orgId, name: c.name, rows: c.rows as any, sortOrder: i } });
        chartCount++;
      }
    });
    return { ok: true, priceItems: priceCount, sizeCharts: chartCount };
  }

  /** Texto compacto (valores por faixa + medidas) injetado no prompt da IA da gráfica. */
  async graficaCatalogText(orgId: string): Promise<string> {
    const [items, charts] = await Promise.all([
      this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.graficaPriceItem.findMany({ where: { organizationId: orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).catch(() => [] as any[]),
      this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.graficaSizeChart.findMany({ where: { organizationId: orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).catch(() => [] as any[]),
    ]);
    if (!items.length && !charts.length) return "";
    const real = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
    const lines: string[] = [];
    if (items.length) {
      lines.push("TABELA DE VALORES (preço POR UNIDADE conforme a QUANTIDADE — sempre use a faixa da quantidade pedida; ex.: 12 unidades usam a faixa de 10):");
      const byCat = new Map<string, string[]>();
      for (const it of items as any[]) {
        const tiers = ([...(Array.isArray(it.tiers) ? it.tiers : [])] as Array<{ minQty: number; priceCents: number }>).sort((a, b) => a.minQty - b.minQty);
        const tierTxt = tiers.map((t) => `${t.minQty}+ ${real(t.priceCents)}`).join(" · ");
        const cat = (it.category || "Outros").trim();
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(`- ${it.name}: ${tierTxt}`);
      }
      for (const [cat, ls] of byCat) lines.push(`*${cat}*\n${ls.join("\n")}`);
    }
    if (charts.length) {
      lines.push("TABELA DE MEDIDAS (comprimento × largura por tamanho):");
      for (const c of charts as any[]) {
        const rows = (Array.isArray(c.rows) ? c.rows : []) as Array<{ size: string; comprimento?: string; largura?: string }>;
        const txt = rows.map((r) => `${r.size}: ${r.comprimento ?? "?"}×${r.largura ?? "?"}`).join(" · ");
        lines.push(`*${c.name}* — ${txt}`);
      }
    }
    return lines.join("\n");
  }
}
