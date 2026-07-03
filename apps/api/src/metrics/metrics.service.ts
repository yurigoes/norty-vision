import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrgAiService } from "../ai/org-ai.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class MetricsService {
  private readonly logger = new Logger("Metrics");
  constructor(private readonly prisma: PrismaService, private readonly orgAi: OrgAiService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, storeId: ctx.storeId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ===== VENDAS HISTÓRICAS (importadas do legado) no BI =====
  // Corte automático: o histórico conta só ATÉ a 1ª venda registrada no PDV novo;
  // a partir daí vale o sistema novo (evita contar período em dobro).
  private async cutoverDate(ctx: RequestContext): Promise<Date> {
    const first = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.sale.findFirst({ where: { status: { not: "canceled" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })).catch(() => null);
    return first?.createdAt ?? new Date(); // sem venda nova → todo o histórico conta
  }
  /** Soma de faturamento histórico (centavos) entre [since, cutover). */
  private async histRevenueSince(ctx: RequestContext, since: Date, cutover: Date): Promise<number> {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<{ total: bigint }>>`
      SELECT coalesce(sum(total_cents),0)::bigint AS total FROM historical_sale_item
      WHERE organization_id = app.current_org_id() AND sale_date >= ${since}::date AND sale_date < ${cutover}::date`).catch(() => [] as any[]);
    return Number(rows[0]?.total ?? 0);
  }

  /** Visão geral pro painel da empresa. */
  async overview(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    const d30 = new Date(now.getTime() - 30 * 86400_000);

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      // vendas de hoje
      const salesToday = await tx.sale.findMany({
        where: { status: { not: "canceled" }, createdAt: { gte: startToday } },
        select: { totalCents: true },
      });
      const salesTotal = salesToday.reduce((s, x) => s + Number(x.totalCents), 0);

      // agendamentos de hoje
      const apptsToday = await tx.appointment.count({
        where: { deletedAt: null, startsAt: { gte: startToday, lte: endToday }, status: { not: "canceled" } },
      });

      // taxa de no-show (30d)
      const [noShow, attended] = await Promise.all([
        tx.appointment.count({ where: { deletedAt: null, status: "no_show", startsAt: { gte: d30 } } }),
        tx.appointment.count({ where: { deletedAt: null, status: "attended", startsAt: { gte: d30 } } }),
      ]);
      const denom = noShow + attended;
      const noShowRate30d = denom > 0 ? noShow / denom : null;

      // parcelas vencidas
      const overdue = await tx.creditInstallment.findMany({
        where: { status: { notIn: ["paid", "canceled"] }, dueDate: { lt: startToday } },
        select: { amountCents: true },
      });
      const overdueTotal = overdue.reduce((s, x) => s + Number(x.amountCents), 0);

      // pendências abertas + caixas abertos
      const [openFollowups, cashOpen] = await Promise.all([
        tx.customerFollowup.count({ where: { status: "open" } }),
        tx.cashRegister.count({ where: { status: "open" } }),
      ]);

      return {
        salesToday: { count: salesToday.length, totalCents: salesTotal },
        appointmentsToday: { count: apptsToday },
        noShowRate30d,
        overdueInstallments: { count: overdue.length, totalCents: overdueTotal },
        openFollowups,
        cashOpen,
      };
    });
  }

  // ============================== BI ÓTICA ==============================
  /** Dashboard BI da ótica: agenda (slots/status), vendas (óculos, top produtos/
   *  grupos, meio de pagamento), tendência semanal e previsão (estatística + IA). */
  async oticaDashboard(ctx: RequestContext, periodDays = 30) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const days = Math.max(7, Math.min(365, Math.round(periodDays || 30)));
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400_000);
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const startWeek = new Date(now.getTime() - 7 * 86400_000);
    const startMonth = new Date(now.getTime() - 30 * 86400_000);

    const core = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      // ---- AGENDA ----
      const byStatus = await tx.appointment.groupBy({ by: ["status"], where: { deletedAt: null, startsAt: { gte: from } }, _count: { _all: true } }).catch(() => [] as any[]);
      const apt: Record<string, number> = {};
      for (const r of byStatus) apt[r.status] = r._count._all;
      // slots futuros (próximos 30 dias) — abertos vs ocupados
      const slotAgg = await tx.scheduleSlot.aggregate({ where: { isBlocked: false, startsAt: { gte: startToday, lte: new Date(now.getTime() + 30 * 86400_000) } }, _sum: { capacity: true, used: true } }).catch(() => ({ _sum: { capacity: 0, used: 0 } } as any));
      const capacity = Number(slotAgg._sum.capacity ?? 0);
      const used = Number(slotAgg._sum.used ?? 0);

      // ---- VENDAS (período) ----
      const sales = await tx.sale.findMany({ where: { status: { not: "canceled" }, createdAt: { gte: from } }, select: { totalCents: true, paymentMethod: true } });
      const salesRevenue = sales.reduce((s, x) => s + Number(x.totalCents), 0);
      const salesCount = sales.length;
      const ticketMedio = salesCount > 0 ? Math.round(salesRevenue / salesCount) : 0;
      const byPay: Record<string, number> = {};
      for (const s of sales) byPay[s.paymentMethod] = (byPay[s.paymentMethod] ?? 0) + Number(s.totalCents);

      // óculos vendidos (qtd de itens) no período
      const itemsAgg = await tx.saleItem.aggregate({ where: { sale: { status: { not: "canceled" }, createdAt: { gte: from } } }, _sum: { qty: true } }).catch(() => ({ _sum: { qty: 0 } } as any));
      const glassesSold = Number(itemsAgg._sum.qty ?? 0);

      // top produtos (por qtd e receita) — agrupado por nome do item
      const topProducts = await tx.$queryRaw<Array<{ name: string; qty: bigint; revenue: bigint }>>`
        SELECT si.product_name AS name, sum(si.qty)::bigint AS qty, sum(si.line_total_cents)::bigint AS revenue
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.status <> 'canceled' AND s.created_at >= ${from}
        GROUP BY si.product_name ORDER BY qty DESC LIMIT 10`.catch(() => []);
      // top grupos (categoria do produto) — join opcional em products
      const topCategories = await tx.$queryRaw<Array<{ category: string; qty: bigint; revenue: bigint }>>`
        SELECT COALESCE(NULLIF(p.category, ''), 'Sem grupo') AS category, sum(si.qty)::bigint AS qty, sum(si.line_total_cents)::bigint AS revenue
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE s.status <> 'canceled' AND s.created_at >= ${from}
        GROUP BY 1 ORDER BY qty DESC LIMIT 8`.catch(() => []);

      // financeiro rápido (hoje/semana/mês)
      const sumSince = async (since: Date) => {
        const rows = await tx.sale.findMany({ where: { status: { not: "canceled" }, createdAt: { gte: since } }, select: { totalCents: true } });
        return rows.reduce((s, x) => s + Number(x.totalCents), 0);
      };
      const [revToday, revWeek, revMonth] = await Promise.all([sumSince(startToday), sumSince(startWeek), sumSince(startMonth)]);

      const confirmRate = (apt["confirmed"] ?? 0) + (apt["pending"] ?? 0) > 0
        ? Math.round(((apt["confirmed"] ?? 0) / ((apt["confirmed"] ?? 0) + (apt["pending"] ?? 0))) * 100) : null;

      return {
        periodDays: days,
        agenda: {
          slotsCapacity: capacity, slotsUsed: used, slotsOpen: Math.max(0, capacity - used),
          occupancyRate: capacity > 0 ? Math.round((used / capacity) * 100) : null,
          confirmed: apt["confirmed"] ?? 0, pending: apt["pending"] ?? 0, canceled: apt["canceled"] ?? 0,
          noShow: apt["no_show"] ?? 0, attended: apt["attended"] ?? 0, rescheduled: apt["rescheduled"] ?? 0,
          confirmRate,
        },
        sales: {
          count: salesCount, revenueCents: salesRevenue, ticketMedioCents: ticketMedio, glassesSold,
          topProducts: topProducts.map((p) => ({ name: p.name, qty: Number(p.qty), revenueCents: Number(p.revenue) })),
          topCategories: topCategories.map((c) => ({ category: c.category, qty: Number(c.qty), revenueCents: Number(c.revenue) })),
          byPaymentMethod: Object.entries(byPay).map(([method, cents]) => ({ method, totalCents: cents })),
        },
        financeiro: { revTodayCents: revToday, revWeekCents: revWeek, revMonthCents: revMonth },
      };
    });

    // ---- VENDAS HISTÓRICAS (importadas) — somam no faturamento até o corte ----
    const cutover = await this.cutoverDate(ctx);
    const [histPeriod, histToday, histWeek, histMonth] = await Promise.all([
      this.histRevenueSince(ctx, from, cutover), this.histRevenueSince(ctx, startToday, cutover),
      this.histRevenueSince(ctx, startWeek, cutover), this.histRevenueSince(ctx, startMonth, cutover),
    ]);
    const histTop = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<{ name: string; qty: number; revenue: bigint }>>`
      SELECT product_name AS name, sum(qty)::float AS qty, sum(total_cents)::bigint AS revenue FROM historical_sale_item
      WHERE organization_id = app.current_org_id() AND sale_date >= ${from}::date AND sale_date < ${cutover}::date
      GROUP BY 1 ORDER BY revenue DESC LIMIT 10`).catch(() => [] as any[]);
    if (histPeriod > 0 || histTop.length) {
      core.sales.revenueCents += histPeriod;
      (core.sales as any).historicalRevenueCents = histPeriod;
      core.financeiro.revTodayCents += histToday; core.financeiro.revWeekCents += histWeek; core.financeiro.revMonthCents += histMonth;
      // mescla top produtos por nome (live + histórico)
      const map = new Map<string, { name: string; qty: number; revenueCents: number }>();
      for (const p of core.sales.topProducts) map.set(p.name, { name: p.name, qty: p.qty, revenueCents: p.revenueCents });
      for (const h of histTop) { const cur = map.get(h.name) ?? { name: h.name, qty: 0, revenueCents: 0 }; cur.qty += Number(h.qty); cur.revenueCents += Number(h.revenue); map.set(h.name, cur); }
      core.sales.topProducts = [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
    }

    // ---- TENDÊNCIA SEMANAL (12 semanas) + PREVISÃO ----
    const trend = await this.weeklyRevenue(ctx, 12);
    const forecast = this.forecastFromWeekly(trend.map((t) => t.revenueCents));
    const aiInsight = await this.salesInsight(ctx.orgId ?? null, { trend, top: core.sales.topProducts, forecast, hasHistorical: histPeriod > 0 || histTop.length > 0 }).catch(() => null);

    return { ...core, trend, forecast, aiInsight };
  }

  /** Receita por semana (N semanas) — série pro gráfico e pra previsão. */
  private async weeklyRevenue(ctx: RequestContext, weeks: number): Promise<Array<{ week: string; revenueCents: number; count: number }>> {
    try {
      const cutover = await this.cutoverDate(ctx);
      const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<{ wk: Date; revenue: bigint; cnt: bigint }>>`
        SELECT date_trunc('week', created_at) AS wk, sum(total_cents)::bigint AS revenue, count(*)::bigint AS cnt
        FROM sales WHERE status <> 'canceled' AND created_at > now() - (${weeks}::int * interval '1 week')
        GROUP BY 1 ORDER BY 1`);
      // histórico importado (até o corte) — soma na mesma série semanal
      const hist = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRaw<Array<{ wk: Date; revenue: bigint; cnt: bigint }>>`
        SELECT date_trunc('week', sale_date) AS wk, sum(total_cents)::bigint AS revenue, count(*)::bigint AS cnt
        FROM historical_sale_item
        WHERE organization_id = app.current_org_id() AND sale_date > (now() - (${weeks}::int * interval '1 week'))::date AND sale_date < ${cutover}::date
        GROUP BY 1 ORDER BY 1`).catch(() => [] as any[]);
      const byWeek = new Map<string, { revenueCents: number; count: number }>();
      for (const r of rows) { const k = new Date(r.wk).toISOString().slice(0, 10); byWeek.set(k, { revenueCents: Number(r.revenue), count: Number(r.cnt) }); }
      for (const r of hist) { const k = new Date(r.wk).toISOString().slice(0, 10); const cur = byWeek.get(k) ?? { revenueCents: 0, count: 0 }; cur.revenueCents += Number(r.revenue); cur.count += Number(r.cnt); byWeek.set(k, cur); }
      return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, revenueCents: v.revenueCents, count: v.count }));
    } catch (e: any) {
      this.logger.warn(`weeklyRevenue indisponível: ${e?.message ?? e}`);
      return [];
    }
  }

  /** Previsão simples: média das últimas semanas + tendência linear (mínimos quadrados). */
  private forecastFromWeekly(series: number[]): { nextWeekCents: number; nextMonthCents: number; nextQuarterCents: number; method: string } {
    const s = series.filter((n) => Number.isFinite(n));
    if (s.length < 2) {
      const base = s[0] ?? 0;
      return { nextWeekCents: base, nextMonthCents: base * 4, nextQuarterCents: base * 13, method: "média" };
    }
    const recent = s.slice(-8); // até 8 semanas recentes
    const n = recent.length;
    const xs = recent.map((_, i) => i);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = recent.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i]! - meanX) * (recent[i]! - meanY); den += (xs[i]! - meanX) ** 2; }
    const slope = den !== 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    const predictAt = (x: number) => Math.max(0, Math.round(intercept + slope * x));
    const nextWeek = predictAt(n); // próxima semana
    // mês/trimestre = soma das próximas 4 / 13 semanas previstas
    let month = 0, quarter = 0;
    for (let i = 0; i < 13; i++) { const v = predictAt(n + i); if (i < 4) month += v; quarter += v; }
    return { nextWeekCents: nextWeek, nextMonthCents: month, nextQuarterCents: quarter, method: "tendência linear (8 semanas)" };
  }

  /** Insight da IA (best-effort): comentário curto + meta sugerida. null se sem IA. */
  private async salesInsight(orgId: string | null, data: { trend: Array<{ week: string; revenueCents: number }>; top: Array<{ name: string; qty: number }>; forecast: { nextWeekCents: number; nextMonthCents: number }; hasHistorical?: boolean }): Promise<string | null> {
    if (!orgId) return null;
    const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const serie = data.trend.slice(-8).map((t) => `${t.week}: ${brl(t.revenueCents)}`).join("; ");
    const tops = data.top.slice(0, 5).map((p) => `${p.name} (${p.qty})`).join(", ");
    const histNote = data.hasHistorical
      ? "\nObservação: a série inclui VENDAS HISTÓRICAS importadas do sistema anterior (item a item). Use-as para tendência, sazonalidade e mix de produtos, mas NÃO tire conclusões sobre ticket médio por venda, clientes/recompra ou meios de pagamento (esses dados não existem no histórico)."
      : "";
    const system = "Você é um analista de BI de uma ótica. Em português do Brasil, escreva um parágrafo curto (até 4 frases) com a leitura das vendas: tendência, o que está puxando, e uma meta realista pra próxima semana/mês. Seja concreto e direto, sem repetir os números crus todos. Não invente dados além dos fornecidos.";
    const user = `Receita semanal recente: ${serie || "sem dados"}.\nMais vendidos: ${tops || "—"}.\nProjeção estatística: próxima semana ${brl(data.forecast.nextWeekCents)}, próximo mês ${brl(data.forecast.nextMonthCents)}.${histNote}`;
    const out = await this.orgAi.complete(orgId, system, user, 260).catch(() => null);
    return out?.trim() || null;
  }
}
