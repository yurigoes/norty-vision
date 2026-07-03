import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

interface ImportRow {
  legacyCode?: string | null;
  saleDate: string; // yyyy-mm-dd
  productName: string;
  qty?: number;
  unitPriceCents?: number;
  discountCents?: number;
  totalCents?: number;
}

@Injectable()
export class HistoricalSalesService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /** Importa um lote de vendas históricas (item a item). Retorna o batchId p/ desfazer. */
  async importRows(ctx: RequestContext, rows: ImportRow[], source?: string): Promise<any> {
    this.requireAdmin(ctx);
    const valid = (rows ?? []).filter((r) => r && r.saleDate && r.productName);
    if (!valid.length) throw new AppError(ErrorCode.ValidationFailed, "Nenhuma linha válida para importar", 400);
    if (valid.length > 5000) throw new AppError(ErrorCode.ValidationFailed, "Limite de 5000 linhas por importação", 400);
    const importBatchId = randomUUID();
    const data = valid.map((r) => ({
      organizationId: ctx.orgId!, storeId: ctx.storeId ?? null,
      legacyCode: r.legacyCode ?? null,
      saleDate: new Date(r.saleDate + "T00:00:00Z"),
      productName: String(r.productName).slice(0, 300),
      qty: Number(r.qty ?? 1) || 1,
      unitPriceCents: BigInt(Math.max(0, Math.round(r.unitPriceCents ?? 0))),
      discountCents: BigInt(Math.max(0, Math.round(r.discountCents ?? 0))),
      totalCents: BigInt(Math.max(0, Math.round(r.totalCents ?? 0))),
      source: source ?? "import",
      importBatchId,
      createdBy: ctx.userId ?? null,
    }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.historicalSaleItem.createMany({ data }));
    const totalCents = data.reduce((s, d) => s + Number(d.totalCents), 0);
    return { ok: true, batchId: importBatchId, count: data.length, totalCents };
  }

  async list(ctx: RequestContext, opts?: { month?: string; q?: string; batchId?: string; limit?: number }): Promise<any[]> {
    this.requireAdmin(ctx);
    const where: any = {};
    if (opts?.q) where.productName = { contains: opts.q, mode: "insensitive" };
    if (opts?.batchId) where.importBatchId = opts.batchId;
    if (opts?.month && /^\d{4}-\d{2}$/.test(opts.month)) {
      const start = new Date(opts.month + "-01T00:00:00Z");
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      where.saleDate = { gte: start, lt: end };
    }
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.historicalSaleItem.findMany({ where, orderBy: { saleDate: "desc" }, take: Math.min(opts?.limit ?? 300, 2000) }));
    return rows.map((r: any) => ({ ...r, qty: Number(r.qty), unitPriceCents: Number(r.unitPriceCents), discountCents: Number(r.discountCents), totalCents: Number(r.totalCents) }));
  }

  /** Resumo: total geral, por mês e top produtos. */
  async summary(ctx: RequestContext): Promise<any> {
    this.requireAdmin(ctx);
    const geral = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT count(*)::int AS itens, coalesce(sum(qty),0)::float AS qtd, coalesce(sum(total_cents),0)::bigint AS total_cents, coalesce(sum(discount_cents),0)::bigint AS desconto_cents
      FROM historical_sale_item WHERE organization_id = app.current_org_id()`).catch(() => [] as any[]);
    const porMes = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT to_char(sale_date,'YYYY-MM') AS mes, count(*)::int AS itens, coalesce(sum(total_cents),0)::bigint AS total_cents
      FROM historical_sale_item WHERE organization_id = app.current_org_id()
      GROUP BY 1 ORDER BY 1 DESC LIMIT 36`).catch(() => [] as any[]);
    const topProdutos = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT product_name, count(*)::int AS itens, coalesce(sum(total_cents),0)::bigint AS total_cents
      FROM historical_sale_item WHERE organization_id = app.current_org_id()
      GROUP BY 1 ORDER BY total_cents DESC LIMIT 20`).catch(() => [] as any[]);
    const num = (v: any) => Number(v ?? 0);
    return {
      geral: geral[0] ? { itens: num(geral[0].itens), qtd: num(geral[0].qtd), totalCents: num(geral[0].total_cents), descontoCents: num(geral[0].desconto_cents) } : { itens: 0, qtd: 0, totalCents: 0, descontoCents: 0 },
      porMes: porMes.map((m) => ({ mes: m.mes, itens: num(m.itens), totalCents: num(m.total_cents) })),
      topProdutos: topProdutos.map((p) => ({ produto: p.product_name, itens: num(p.itens), totalCents: num(p.total_cents) })),
    };
  }

  /** Lotes importados (p/ desfazer). */
  async batches(ctx: RequestContext): Promise<any[]> {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<any>>`
      SELECT import_batch_id::text AS batch_id, count(*)::int AS itens, coalesce(sum(total_cents),0)::bigint AS total_cents,
             min(created_at) AS criado_em, min(sale_date) AS de, max(sale_date) AS ate
      FROM historical_sale_item WHERE organization_id = app.current_org_id() AND import_batch_id IS NOT NULL
      GROUP BY 1 ORDER BY criado_em DESC LIMIT 50`).catch(() => [] as any[]);
    return rows.map((r) => ({ batchId: r.batch_id, itens: Number(r.itens), totalCents: Number(r.total_cents), criadoEm: r.criado_em, de: r.de, ate: r.ate }));
  }

  async deleteBatch(ctx: RequestContext, batchId: string): Promise<any> {
    this.requireAdmin(ctx);
    const res = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.historicalSaleItem.deleteMany({ where: { importBatchId: batchId } }));
    return { ok: true, deleted: res.count };
  }
}
