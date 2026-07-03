import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext): string {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId;
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /**
   * Comissão apurada de um vendedor no período (vendas concluídas atribuídas a
   * ele) menos o que já foi pago em payouts com período sobreposto.
   */
  async pending(ctx: RequestContext, sellerUserId: string, opts: { start?: string; end?: string }) {
    this.requireAdmin(ctx);
    this.requireOrg(ctx);
    const from = opts.start ? new Date(opts.start + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.end ? new Date(opts.end + "T23:59:59Z") : new Date();

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const sales = await tx.sale.findMany({
        where: {
          status: "completed",
          createdAt: { gte: from, lte: to },
          OR: [{ sellerUserId }, { sellerUserId: null, operatorUserId: sellerUserId }],
        },
        select: { totalCents: true },
        take: 20000,
      });
      const salesCount = sales.length;
      const baseCents = sales.reduce((s, x) => s + Number(x.totalCents), 0);

      const membership = await tx.membership.findFirst({
        where: { userId: sellerUserId, organizationId: ctx.orgId ?? undefined },
        select: { commissionPct: true },
      });
      const pct = membership?.commissionPct != null ? Number(String(membership.commissionPct)) : 0;
      const totalCents = Math.round(baseCents * (pct / 100));

      return { from, to, salesCount, baseCents, commissionPct: pct, totalCents };
    });
  }

  async listPayouts(ctx: RequestContext, opts?: { sellerUserId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const items = await tx.commissionPayout.findMany({
        where: { ...(opts?.sellerUserId ? { sellerUserId: opts.sellerUserId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const userIds = [...new Set(items.map((i) => i.sellerUserId))];
      const users = userIds.length
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
      const um = new Map(users.map((u) => [u.id, u.name]));
      return items.map((i) => ({ ...i, sellerName: um.get(i.sellerUserId) ?? "—" }));
    });
  }

  async createPayout(
    ctx: RequestContext,
    input: {
      sellerUserId: string;
      periodStart?: string | null;
      periodEnd?: string | null;
      salesCount?: number;
      baseCents?: number;
      commissionPct?: number | null;
      totalCents: number;
      notes?: string | null;
    },
  ) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    if (input.totalCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Valor inválido", 400);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.commissionPayout.create({
        data: {
          organizationId: orgId,
          sellerUserId: input.sellerUserId,
          periodStart: input.periodStart ? new Date(input.periodStart) : null,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
          salesCount: input.salesCount ?? 0,
          baseCents: BigInt(Math.max(0, Math.round(input.baseCents ?? 0))),
          commissionPct: input.commissionPct != null ? input.commissionPct : null,
          totalCents: BigInt(Math.max(0, Math.round(input.totalCents))),
          status: "pending",
          notes: input.notes ?? null,
          createdByUserId: ctx.userId ?? null,
        },
      }),
    );
  }

  async payPayout(
    ctx: RequestContext,
    id: string,
    input: { paymentMethod: string; paymentId?: string | null; proofUrl?: string | null },
  ) {
    this.requireAdmin(ctx);
    await this.getPayout(ctx, id);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.commissionPayout.update({
        where: { id },
        data: {
          status: "paid",
          paidAt: new Date(),
          paymentMethod: input.paymentMethod,
          paymentId: input.paymentId ?? null,
          proofUrl: input.proofUrl ?? null,
        },
      }),
    );
  }

  async getPayout(ctx: RequestContext, id: string) {
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.commissionPayout.findFirst({ where: { id } }),
    );
    if (!p) throw new AppError(ErrorCode.NotFound, "Pagamento não encontrado", 404);
    return p;
  }

  /** Recibo HTML com branding da empresa. */
  async receiptHtml(ctx: RequestContext, id: string): Promise<string> {
    const orgId = this.requireOrg(ctx);
    const data = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const p = await tx.commissionPayout.findFirst({ where: { id } });
      if (!p) throw new AppError(ErrorCode.NotFound, "Pagamento não encontrado", 404);
      const seller = await tx.user.findFirst({ where: { id: p.sellerUserId }, select: { name: true, email: true } });
      const org = await tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true } });
      return { p, seller, org };
    });
    return buildCommissionReceipt({
      brandName: data.org?.name ?? "Empresa",
      logoUrl: data.org?.logoUrl ?? null,
      color: data.org?.primaryColor ?? "#7c3aed",
      sellerName: data.seller?.name ?? "Vendedor",
      sellerEmail: data.seller?.email ?? null,
      payout: data.p,
    });
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function brl(cents: number | bigint): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildCommissionReceipt(opts: {
  brandName: string; logoUrl: string | null; color: string;
  sellerName: string; sellerEmail: string | null; payout: any;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const p = opts.payout;
  const header = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${esc(opts.brandName)}</span>`;
  const period = p.periodStart
    ? `${new Date(p.periodStart).toLocaleDateString("pt-BR")} a ${p.periodEnd ? new Date(p.periodEnd).toLocaleDateString("pt-BR") : "—"}`
    : "—";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Recibo de comissão</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:720px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:8px}
  h1{font-size:18px;color:${color};margin:16px 0 4px}
  .meta{font-size:13px;color:#555;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:${color};color:#fff;padding:8px;border:1px solid ${color};font-size:12px;text-align:left}
  td{padding:8px;border:1px solid #ddd;font-size:13px}
  .total{font-size:18px;font-weight:700;text-align:right;margin-top:12px;color:${color}}
  .status{display:inline-block;font-size:11px;text-transform:uppercase;color:#fff;background:${color};padding:3px 10px;border-radius:999px}
  .toolbar{text-align:center;padding:10px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header>${header}<span class="status">${esc(p.status === "paid" ? "pago" : "pendente")}</span></header>
    <h1>Recibo de comissão</h1>
    <p class="meta">
      Vendedor: <strong>${esc(opts.sellerName)}</strong>${opts.sellerEmail ? ` · ${esc(opts.sellerEmail)}` : ""}<br/>
      Período: ${esc(period)}<br/>
      ${p.paidAt ? `Pago em: ${new Date(p.paidAt).toLocaleString("pt-BR")}<br/>` : ""}
      ${p.paymentMethod ? `Forma: ${esc(p.paymentMethod)}${p.paymentId ? ` · ID ${esc(p.paymentId)}` : ""}<br/>` : ""}
    </p>
    <table>
      <thead><tr><th>Descrição</th><th style="text-align:right;width:160px">Valor</th></tr></thead>
      <tbody>
        <tr><td>Vendas no período</td><td style="text-align:right">${Number(p.salesCount)}</td></tr>
        <tr><td>Faturamento base</td><td style="text-align:right">${brl(p.baseCents)}</td></tr>
        <tr><td>Percentual de comissão</td><td style="text-align:right">${p.commissionPct != null ? `${Number(String(p.commissionPct))}%` : "—"}</td></tr>
      </tbody>
    </table>
    <p class="total">Comissão: ${brl(p.totalCents)}</p>
  </div>
</body></html>`;
}
