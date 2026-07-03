import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

interface UpsertProductInput {
  storeId?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  priceCashCents?: number | null;
  priceCardFullCents?: number | null;
  priceCardInstallmentsCents?: number | null;
  priceCreditCents?: number | null;
  creditInterestPct?: number | null;
  earlyPaymentDiscountPct?: number | null;
  maxInstallments?: number | null;
  stockQty?: number;
  minStockQty?: number;
  trackStock?: boolean;
  isActive?: boolean;
  showInCatalog?: boolean;
  costCents?: number | null;
  laboratorySupplierId?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  origem?: number | null;
  unidade?: string | null;
  cst?: string | null;
  csosn?: string | null;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async list(ctx: RequestContext, opts?: { search?: string; activeOnly?: boolean; storeId?: string }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const products = await tx.product.findMany({
        where: {
          deletedAt: null,
          ...(opts?.activeOnly ? { isActive: true } : {}),
          ...(opts?.search
            ? {
                OR: [
                  { name: { contains: opts.search, mode: "insensitive" } },
                  { sku: { contains: opts.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        take: 500,
      });
      // PDV: quando vem o storeId, o stockQty reflete o SALDO DAQUELA LOJA
      // (e expõe storeStockQty), pro aviso de estoque ser por loja, não o total.
      if (opts?.storeId && products.length) {
        const balances = await tx.productStoreStock.findMany({
          where: { storeId: opts.storeId, productId: { in: products.map((p) => p.id) } },
          select: { productId: true, qty: true },
        });
        const bal = new Map(balances.map((b) => [b.productId, b.qty]));
        return products.map((p) => ({ ...p, storeStockQty: bal.get(p.id) ?? 0, stockQty: bal.get(p.id) ?? 0 }));
      }
      return products;
    });
  }

  async getById(ctx: RequestContext, id: string) {
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!p) throw new AppError(ErrorCode.NotFound, "Produto nao encontrado", 404);
    return p;
  }

  /** Gera um SKU único na org (editável depois). Ex.: OCU-7K3F. */
  private async genSku(ctx: RequestContext, name: string, category?: string | null): Promise<string> {
    const base = (category || name || "PRD")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "PRD";
    const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 8; attempt++) {
      let suf = "";
      for (let i = 0; i < 4; i++) suf += alpha[Math.floor(Math.random() * alpha.length)];
      const sku = `${base}-${suf}`;
      const dup = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.product.findFirst({ where: { organizationId: ctx.orgId!, sku, deletedAt: null }, select: { id: true } }),
      );
      if (!dup) return sku;
    }
    return `${base}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
  }

  async create(ctx: RequestContext, input: UpsertProductInput) {
    if (!ctxCan(ctx, "products.create")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para criar produto", 403);
    }
    const sku = input.sku?.trim() || (await this.genSku(ctx, input.name, input.category));
    // lentes não vão à vitrine por padrão (só se o admin marcar explicitamente).
    const isLens = (input.category ?? "").toLowerCase().includes("lente");
    const showInCatalog = (input as any).showInCatalog ?? (isLens ? false : true);
    const initialQty = input.stockQty ?? 0;
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const prod = await tx.product.create({
        data: {
          organizationId: ctx.orgId!,
          storeId: input.storeId ?? null,
          sku,
          name: input.name,
          showInCatalog,
          laboratorySupplierId: (input as any).laboratorySupplierId ?? null,
          description: input.description ?? null,
          category: input.category ?? null,
          imageUrl: input.imageUrl ?? null,
          priceCashCents: input.priceCashCents ?? null,
          priceCardFullCents: input.priceCardFullCents ?? null,
          priceCardInstallmentsCents: input.priceCardInstallmentsCents ?? null,
          priceCreditCents: input.priceCreditCents ?? null,
          creditInterestPct: input.creditInterestPct ?? null,
          earlyPaymentDiscountPct: input.earlyPaymentDiscountPct ?? null,
          maxInstallments: input.maxInstallments ?? null,
          stockQty: initialQty,
          minStockQty: input.minStockQty ?? 0,
          trackStock: input.trackStock ?? false,
          isActive: input.isActive ?? true,
          costCents: (input as any).costCents ?? null,
          ncm: (input as any).ncm ?? null,
          cfop: (input as any).cfop ?? null,
          cest: (input as any).cest ?? null,
          origem: (input as any).origem ?? 0,
          unidade: (input as any).unidade ?? "UN",
          cst: (input as any).cst ?? null,
          csosn: (input as any).csosn ?? null,
        },
      });
      // estoque por loja: semeia o estoque inicial na loja escolhida (ou a mais antiga)
      if (initialQty > 0) {
        const storeId = input.storeId ?? (await tx.store.findFirst({ where: { organizationId: ctx.orgId! }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
        if (storeId) await tx.productStoreStock.create({ data: { organizationId: ctx.orgId!, productId: prod.id, storeId, qty: initialQty } });
      }
      return prod;
    });
  }

  /** Importação em massa de estoque (catálogo de ótica etc.). Dedup por SKU; imagem
   *  de fallback reaproveitada de um produto já cadastrado da org (armação/lente). */
  async bulkImport(ctx: RequestContext, input: { items: Array<{ sku?: string | null; name: string; category?: string | null; priceCents?: number | null; stockQty?: number | null; ncm?: string | null; unidade?: string | null }>; reuseImage?: boolean }) {
    if (!ctxCan(ctx, "products.import")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para importar produtos", 403);
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId;
    const items = (input.items || []).filter((i) => i?.name?.trim());
    if (!items.length) throw new AppError(ErrorCode.ValidationFailed, "Nada para importar", 400);
    if (items.length > 5000) throw new AppError(ErrorCode.ValidationFailed, "Limite de 5000 itens por importação", 400);

    // pass 1: loja padrão, imagens de fallback e SKUs já existentes
    const meta = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const store = await tx.store.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      let imgFrame: string | null = null, imgLens: string | null = null, imgAny: string | null = null;
      if (input.reuseImage) {
        const withImg = await tx.product.findMany({ where: { deletedAt: null, imageUrl: { not: null } }, select: { imageUrl: true, category: true }, take: 300 });
        for (const p of withImg) {
          if (!imgAny) imgAny = p.imageUrl;
          const c = (p.category || "").toLowerCase();
          if (!imgFrame && c.includes("arma")) imgFrame = p.imageUrl;
          if (!imgLens && c.includes("lente")) imgLens = p.imageUrl;
        }
      }
      const existing = await tx.product.findMany({ where: { deletedAt: null }, select: { sku: true } });
      return { storeId: store?.id ?? null, imgFrame, imgLens, imgAny, skus: existing.map((e) => (e.sku || "").toUpperCase()) };
    });
    const skus = new Set(meta.skus);

    let created = 0, skipped = 0;
    const CHUNK = 40;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
        for (const it of chunk) {
          const sku = (it.sku || "").trim();
          if (sku && skus.has(sku.toUpperCase())) { skipped++; continue; }
          const cat = (it.category && it.category.trim())
            || (/(LENTE|MULTIFOCAL|BIFOCAL|VISAO|VISÃO)/i.test(it.name) ? "Lentes" : /^ARMA/i.test(it.name.trim()) ? "Armações" : null);
          const isLens = (cat || "").toLowerCase().includes("lente");
          const img = !input.reuseImage ? null : (isLens ? (meta.imgLens || meta.imgAny) : (meta.imgFrame || meta.imgAny));
          const qty = Math.max(0, Math.trunc(Number(it.stockQty) || 0));
          const finalSku = sku || `IMP-${Date.now().toString(36).toUpperCase().slice(-5)}-${created}`;
          const prod = await tx.product.create({
            data: {
              organizationId: orgId, storeId: null, sku: finalSku, name: it.name.trim().slice(0, 200),
              category: cat, imageUrl: img, priceCashCents: it.priceCents != null ? Math.max(0, Math.round(it.priceCents)) : null,
              stockQty: qty, minStockQty: 0, trackStock: true, isActive: true, showInCatalog: isLens ? false : true,
              ncm: (it.ncm || "").replace(/\D/g, "").slice(0, 8) || null, unidade: (it.unidade || "UN").slice(0, 6) || "UN", origem: 0,
            },
          });
          if (qty > 0 && meta.storeId) await tx.productStoreStock.create({ data: { organizationId: orgId, productId: prod.id, storeId: meta.storeId, qty } });
          skus.add(finalSku.toUpperCase());
          created++;
        }
      });
    }
    return { created, skipped, total: items.length };
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertProductInput>) {
    if (!ctxCan(ctx, "products.edit")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para editar produto", 403);
    }
    const data: Record<string, unknown> = {};
    for (const k of [
      "storeId", "sku", "name", "description", "category", "imageUrl",
      "priceCashCents", "priceCardFullCents", "priceCardInstallmentsCents",
      "priceCreditCents", "creditInterestPct", "earlyPaymentDiscountPct",
      "maxInstallments", "stockQty", "minStockQty", "trackStock", "isActive", "showInCatalog", "costCents",
      "laboratorySupplierId",
      "ncm", "cfop", "cest", "origem", "unidade", "cst", "csosn",
    ] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.update({ where: { id }, data }),
    );
  }

  async softDelete(ctx: RequestContext, id: string) {
    if (!ctxCan(ctx, "products.delete")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para excluir produto", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }

  // ============================== ESTOQUE ==============================
  /**
   * Ajuste manual de estoque (entrada de compra, ajuste de inventário, devolução).
   * mode "set" define o valor absoluto; "delta" soma/subtrai. Registra a movimentação.
   */
  async adjustStock(ctx: RequestContext, id: string, input: { mode: "set" | "delta"; qty: number; reason?: string | null; costCents?: number | null; storeId?: string | null }) {
    if (!ctxCan(ctx, "products.stock")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para mexer no estoque", 403);
    const orgId = ctx.orgId!;
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const p = await tx.product.findFirst({ where: { id, deletedAt: null }, select: { id: true, storeId: true } });
      if (!p) throw new AppError(ErrorCode.NotFound, "Produto não encontrado", 404);
      // loja-alvo do ajuste (informada, ou a do produto, ou a mais antiga da org)
      const targetStore = input.storeId ?? p.storeId ?? (await tx.store.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
      let delta: number;
      if (input.mode === "set") {
        const ex = targetStore ? await tx.productStoreStock.findUnique({ where: { productId_storeId: { productId: id, storeId: targetStore } } }) : null;
        delta = Math.max(0, Math.trunc(input.qty)) - (ex?.qty ?? 0);
      } else {
        delta = Math.trunc(input.qty);
      }
      const after = await applyStoreStockDelta(tx, orgId, id, targetStore, delta);
      await tx.product.update({ where: { id }, data: { trackStock: true, ...(input.costCents != null ? { costCents: Math.trunc(input.costCents) } : {}) } });
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            organizationId: orgId, storeId: targetStore, productId: id,
            kind: delta > 0 ? "purchase" : "adjustment", qty: delta, qtyAfter: after,
            reason: input.reason ?? (input.mode === "set" ? "Ajuste de inventário" : "Ajuste manual"),
            referenceType: "manual", createdByUserId: ctx.userId ?? null,
          },
        });
      }
      return tx.product.findFirst({ where: { id } });
    });
  }

  /** Transfere saldo de um produto entre lojas da empresa (total inalterado). */
  async transferStock(ctx: RequestContext, id: string, input: { fromStoreId: string; toStoreId: string; qty: number; reason?: string | null }) {
    if (!ctxCan(ctx, "products.stock")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para mexer no estoque", 403);
    const orgId = ctx.orgId!;
    const qty = Math.trunc(input.qty);
    if (!input.fromStoreId || !input.toStoreId) throw new AppError(ErrorCode.ValidationFailed, "Informe a loja de origem e destino", 400);
    if (input.fromStoreId === input.toStoreId) throw new AppError(ErrorCode.ValidationFailed, "Origem e destino devem ser diferentes", 400);
    if (qty <= 0) throw new AppError(ErrorCode.ValidationFailed, "Quantidade inválida", 400);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const p = await tx.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!p) throw new AppError(ErrorCode.NotFound, "Produto não encontrado", 404);
      // valida lojas da org
      const stores = await tx.store.findMany({ where: { id: { in: [input.fromStoreId, input.toStoreId] }, organizationId: orgId }, select: { id: true } });
      if (stores.length !== 2) throw new AppError(ErrorCode.ValidationFailed, "Loja inválida", 400);
      const fromBal = await tx.productStoreStock.findUnique({ where: { productId_storeId: { productId: id, storeId: input.fromStoreId } } });
      if ((fromBal?.qty ?? 0) < qty) throw new AppError(ErrorCode.ValidationFailed, `Saldo insuficiente na loja de origem (disponível: ${fromBal?.qty ?? 0})`, 400);
      const reason = input.reason?.trim() || "Transferência entre lojas";
      const afterFrom = await applyStoreStockDelta(tx, orgId, id, input.fromStoreId, -qty);
      const afterTo = await applyStoreStockDelta(tx, orgId, id, input.toStoreId, qty);
      await tx.product.update({ where: { id }, data: { trackStock: true } });
      await tx.stockMovement.createMany({ data: [
        { organizationId: orgId, storeId: input.fromStoreId, productId: id, kind: "transfer", qty: -qty, qtyAfter: afterFrom, reason: `${reason} (saída)`, referenceType: "transfer", referenceId: input.toStoreId, createdByUserId: ctx.userId ?? null },
        { organizationId: orgId, storeId: input.toStoreId, productId: id, kind: "transfer", qty: qty, qtyAfter: afterTo, reason: `${reason} (entrada)`, referenceType: "transfer", referenceId: input.fromStoreId, createdByUserId: ctx.userId ?? null },
      ] });
      return { ok: true, fromQty: afterFrom, toQty: afterTo };
    });
  }

  /** Movimentações recentes de um produto (extrato de estoque). */
  async movements(ctx: RequestContext, productId: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.stockMovement.findMany({ where: { productId }, orderBy: { createdAt: "desc" }, take: 100 }),
    );
  }

  /** Saldo de estoque por loja de um produto. */
  async storeStock(ctx: RequestContext, productId: string) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const rows = await tx.productStoreStock.findMany({ where: { productId }, orderBy: { qty: "desc" } });
      const ids = rows.map((r) => r.storeId);
      const stores = ids.length ? await tx.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      const nm = new Map(stores.map((s) => [s.id, s.name]));
      return rows.map((r) => ({ storeId: r.storeId, store: nm.get(r.storeId) ?? "—", qty: r.qty }));
    });
  }

  /** Estoque consolidado por loja (unidades e nº de produtos). */
  async stockByStoreReport(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const grouped = await tx.productStoreStock.groupBy({ by: ["storeId"], _sum: { qty: true }, _count: true });
      const stores = await tx.store.findMany({ where: {}, select: { id: true, name: true } });
      const nm = new Map(stores.map((s) => [s.id, s.name]));
      return grouped
        .map((g: any) => ({ storeId: g.storeId, store: nm.get(g.storeId) ?? "—", units: g._sum?.qty ?? 0, skus: typeof g._count === "number" ? g._count : (g._count?._all ?? 0) }))
        .sort((a: any, b: any) => b.units - a.units);
    });
  }

  /**
   * Relatório de estoque: produtos abaixo do mínimo (por produto) + agregação por
   * grupo (categoria). Só considera produtos com controle de estoque ligado.
   */
  async lowStockReport(ctx: RequestContext) {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.findMany({
        where: { deletedAt: null, trackStock: true, isActive: true },
        select: { id: true, name: true, sku: true, category: true, stockQty: true, minStockQty: true },
        orderBy: { stockQty: "asc" },
        take: 1000,
      }),
    );
    const low = rows.filter((p) => (p.stockQty ?? 0) <= (p.minStockQty ?? 0));
    // agregação por grupo (categoria)
    const byGroupMap = new Map<string, { group: string; lowCount: number; totalQty: number; products: number }>();
    for (const p of rows) {
      const g = (p.category ?? "Sem categoria").trim() || "Sem categoria";
      const e = byGroupMap.get(g) ?? { group: g, lowCount: 0, totalQty: 0, products: 0 };
      e.products += 1;
      e.totalQty += p.stockQty ?? 0;
      if ((p.stockQty ?? 0) <= (p.minStockQty ?? 0)) e.lowCount += 1;
      byGroupMap.set(g, e);
    }
    const byGroup = [...byGroupMap.values()].sort((a, b) => b.lowCount - a.lowCount || a.group.localeCompare(b.group));
    return {
      products: low.map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category ?? "Sem categoria", stockQty: p.stockQty ?? 0, minStockQty: p.minStockQty ?? 0 })),
      byGroup,
      totalTracked: rows.length,
      totalLow: low.length,
    };
  }

  /**
   * Análise de estoque: valor parado (custo × qtd) e margem por grupo + total;
   * sugestão de reposição (cruza giro × mínimo) e Curva ABC por faturamento.
   * Usa os últimos 90 dias de venda como base de giro.
   */
  async inventoryAnalytics(ctx: RequestContext) {
    const DAYS = 90;
    const from = new Date(Date.now() - DAYS * 86400_000);
    const products = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, category: true, stockQty: true, minStockQty: true, trackStock: true, costCents: true, priceCashCents: true } }),
    );
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.saleItem.findMany({ where: { sale: { status: "completed", createdAt: { gte: from } } }, select: { productId: true, qty: true, lineTotalCents: true }, take: 10000 }),
    );
    const soldQty = new Map<string, number>();
    const revenue = new Map<string, number>();
    for (const it of items) {
      if (!it.productId) continue;
      soldQty.set(it.productId, (soldQty.get(it.productId) ?? 0) + (it.qty ?? 0));
      revenue.set(it.productId, (revenue.get(it.productId) ?? 0) + Number(it.lineTotalCents ?? 0n));
    }

    // ----- valor em estoque (custo) + venda potencial + margem, por grupo -----
    let totalCostCents = 0, totalSaleCents = 0;
    const groupMap = new Map<string, { group: string; costCents: number; saleCents: number; units: number }>();
    for (const p of products) {
      const q = p.stockQty ?? 0;
      const cost = (p.costCents ?? 0) * q;
      const sale = (p.priceCashCents ?? 0) * q;
      totalCostCents += cost; totalSaleCents += sale;
      const g = (p.category ?? "Sem categoria").trim() || "Sem categoria";
      const e = groupMap.get(g) ?? { group: g, costCents: 0, saleCents: 0, units: 0 };
      e.costCents += cost; e.saleCents += sale; e.units += q;
      groupMap.set(g, e);
    }
    const valueByGroup = [...groupMap.values()].map((e) => ({ ...e, marginCents: e.saleCents - e.costCents })).sort((a, b) => b.costCents - a.costCents);

    // ----- reposição sugerida (giro × mínimo) -----
    const reorder = products
      .filter((p) => p.trackStock)
      .map((p) => {
        const q = p.stockQty ?? 0;
        const sold = soldQty.get(p.id) ?? 0;
        const perDay = sold / DAYS;
        const coverageDays = perDay > 0 ? Math.floor(q / perDay) : null; // null = sem giro
        const target = Math.max(p.minStockQty ?? 0, Math.ceil(perDay * 30)); // cobrir ~30 dias ou o mínimo
        const suggested = Math.max(0, target - q);
        const urgent = q <= (p.minStockQty ?? 0) || (perDay > 0 && coverageDays !== null && coverageDays < 15);
        return { id: p.id, name: p.name, sku: p.sku, category: p.category ?? "Sem categoria", stockQty: q, minStockQty: p.minStockQty ?? 0, sold90d: sold, coverageDays, suggestedQty: suggested, urgent };
      })
      .filter((r) => r.suggestedQty > 0 || r.urgent)
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.coverageDays ?? 9999) - (b.coverageDays ?? 9999))
      .slice(0, 80);

    // ----- Curva ABC por faturamento (90d) -----
    const ranked = products
      .map((p) => ({ id: p.id, name: p.name, category: p.category ?? "Sem categoria", revenueCents: revenue.get(p.id) ?? 0, qty: soldQty.get(p.id) ?? 0 }))
      .filter((p) => p.revenueCents > 0)
      .sort((a, b) => b.revenueCents - a.revenueCents);
    const totalRev = ranked.reduce((s, p) => s + p.revenueCents, 0) || 1;
    let cum = 0;
    const abc = ranked.map((p) => {
      cum += p.revenueCents;
      const pct = cum / totalRev;
      const cls = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
      return { ...p, cls, sharePct: Math.round((p.revenueCents / totalRev) * 1000) / 10 };
    });
    const abcCounts = { A: abc.filter((x) => x.cls === "A").length, B: abc.filter((x) => x.cls === "B").length, C: abc.filter((x) => x.cls === "C").length };

    return {
      periodDays: DAYS,
      value: { totalCostCents, totalSaleCents, marginCents: totalSaleCents - totalCostCents, byGroup: valueByGroup },
      reorder,
      abc: { counts: abcCounts, items: abc.slice(0, 60) },
    };
  }

  /** Exporta um relatório de estoque em CSV (Excel-friendly: ; e vírgula decimal). */
  async inventoryCsv(ctx: RequestContext, kind: string): Promise<{ filename: string; csv: string }> {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const money = (c: number) => (Number(c) / 100).toFixed(2).replace(".", ",");
    const row = (cols: unknown[]) => cols.map(esc).join(";");
    const lines: string[] = [];
    if (kind === "best_sellers") {
      const r = await this.bestSellersReport(ctx);
      lines.push(row(["Produto", "Qtd vendida", "Faturado (R$)"]));
      for (const p of r.products) lines.push(row([p.name, p.qty, money(p.revenueCents)]));
      return { filename: "mais-vendidos.csv", csv: lines.join("\n") };
    }
    if (kind === "value") {
      const a = await this.inventoryAnalytics(ctx);
      lines.push(row(["Grupo", "Unidades", "Custo (R$)", "Venda potencial (R$)", "Margem (R$)"]));
      for (const g of a.value.byGroup) lines.push(row([g.group, g.units, money(g.costCents), money(g.saleCents), money(g.marginCents)]));
      lines.push(row(["TOTAL", "", money(a.value.totalCostCents), money(a.value.totalSaleCents), money(a.value.marginCents)]));
      return { filename: "valor-estoque.csv", csv: lines.join("\n") };
    }
    if (kind === "reorder") {
      const a = await this.inventoryAnalytics(ctx);
      lines.push(row(["Produto", "Categoria", "Estoque", "Mínimo", "Vendas 90d", "Cobertura (dias)", "Comprar", "Urgente"]));
      for (const r of a.reorder) lines.push(row([r.name, r.category, r.stockQty, r.minStockQty, r.sold90d, r.coverageDays ?? "", r.suggestedQty, r.urgent ? "SIM" : ""]));
      return { filename: "reposicao-sugerida.csv", csv: lines.join("\n") };
    }
    if (kind === "abc") {
      const a = await this.inventoryAnalytics(ctx);
      lines.push(row(["Classe", "Produto", "Categoria", "Faturado 90d (R$)", "% do total"]));
      for (const p of a.abc.items) lines.push(row([p.cls, p.name, p.category, money(p.revenueCents), String(p.sharePct).replace(".", ",")]));
      return { filename: "curva-abc.csv", csv: lines.join("\n") };
    }
    // default: baixo estoque
    const ls = await this.lowStockReport(ctx);
    lines.push(row(["Produto", "SKU", "Categoria", "Estoque", "Mínimo"]));
    for (const p of ls.products) lines.push(row([p.name, p.sku ?? "", p.category, p.stockQty, p.minStockQty]));
    return { filename: "estoque-baixo.csv", csv: lines.join("\n") };
  }

  /**
   * Giro / mais vendidos no período (qtd e faturamento), por produto e por grupo.
   * Lê os itens de venda (sale_items) das vendas concluídas.
   */
  async bestSellersReport(ctx: RequestContext, opts?: { from?: string; to?: string }) {
    const from = opts?.from ? new Date(opts.from + "T00:00:00.000Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts?.to ? new Date(opts.to + "T23:59:59.999Z") : new Date();
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.saleItem.findMany({
        where: { sale: { status: "completed", createdAt: { gte: from, lte: to } } },
        select: { productId: true, productName: true, qty: true, lineTotalCents: true },
        take: 5000,
      }),
    );
    // mapa de categoria por produto (pra agrupar)
    const pidList = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])];
    const prods = pidList.length
      ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.product.findMany({ where: { id: { in: pidList } }, select: { id: true, category: true } }))
      : [];
    const catOf = new Map(prods.map((p) => [p.id, (p.category ?? "Sem categoria").trim() || "Sem categoria"]));

    const byProd = new Map<string, { name: string; qty: number; revenueCents: number }>();
    const byGroup = new Map<string, { group: string; qty: number; revenueCents: number }>();
    for (const it of items) {
      const key = it.productId ?? `nome:${it.productName}`;
      const pe = byProd.get(key) ?? { name: it.productName, qty: 0, revenueCents: 0 };
      pe.qty += it.qty ?? 0; pe.revenueCents += Number(it.lineTotalCents ?? 0n);
      byProd.set(key, pe);
      const g = (it.productId ? catOf.get(it.productId) : null) ?? "Sem categoria";
      const ge = byGroup.get(g) ?? { group: g, qty: 0, revenueCents: 0 };
      ge.qty += it.qty ?? 0; ge.revenueCents += Number(it.lineTotalCents ?? 0n);
      byGroup.set(g, ge);
    }
    return {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      products: [...byProd.values()].sort((a, b) => b.qty - a.qty).slice(0, 50),
      byGroup: [...byGroup.values()].sort((a, b) => b.qty - a.qty),
    };
  }
}

/**
 * Aplica um delta de estoque numa (produto, loja) e mantém products.stock_qty como
 * o TOTAL (soma das lojas). Retorna o saldo da loja após. Use dentro de uma transação.
 * Sem loja conhecida → ajusta o total legado direto (fallback).
 */
export async function applyStoreStockDelta(tx: any, orgId: string, productId: string, storeId: string | null | undefined, delta: number): Promise<number> {
  if (!storeId) {
    const p = await tx.product.findFirst({ where: { id: productId }, select: { stockQty: true } });
    const after = Math.max(0, (p?.stockQty ?? 0) + delta);
    await tx.product.update({ where: { id: productId }, data: { stockQty: after } });
    return after;
  }
  const ex = await tx.productStoreStock.findUnique({ where: { productId_storeId: { productId, storeId } } });
  const after = Math.max(0, (ex?.qty ?? 0) + delta);
  await tx.productStoreStock.upsert({
    where: { productId_storeId: { productId, storeId } },
    update: { qty: after },
    create: { organizationId: orgId, productId, storeId, qty: after },
  });
  const agg = await tx.productStoreStock.aggregate({ where: { productId }, _sum: { qty: true } });
  await tx.product.update({ where: { id: productId }, data: { stockQty: agg._sum.qty ?? 0 } });
  return after;
}
