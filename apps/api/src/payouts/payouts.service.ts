import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

export interface PendingItem {
  sourceType: "lens_lab" | "lens_doctor";
  sourceId: string;
  description: string;
  amountCents: number;
}

@Injectable()
export class PayoutsService {
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
    if (!ctxCan(ctx, "payouts.manage")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar repasses", 403);
  }

  /** Itens pendentes (ainda nao incluidos em fechamento) de um fornecedor. */
  async pending(ctx: RequestContext, supplierId: string): Promise<PendingItem[]> {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null } });
      if (!supplier) throw new AppError(ErrorCode.NotFound, "Fornecedor nao encontrado", 404);

      const isLab = supplier.type === "laboratorio";
      const sourceType = isLab ? "lens_lab" : "lens_doctor";

      const orders = await tx.lensOrder.findMany({
        where: isLab
          ? { labSupplierId: supplierId, labCostCents: { not: null } }
          : { doctorSupplierId: supplierId },
        orderBy: { createdAt: "asc" },
      });
      if (orders.length === 0) return [];

      // exclui pedidos ja incluidos em algum item desse tipo
      const already = await tx.settlementItem.findMany({
        where: { sourceType, sourceId: { in: orders.map((o) => o.id) } },
        select: { sourceId: true },
      });
      const usedIds = new Set(already.map((a) => a.sourceId));

      // nomes dos clientes
      const custIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))] as string[];
      const custs = custIds.length
        ? await tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })
        : [];
      const cm = new Map(custs.map((c) => [c.id, c.name]));

      const items: PendingItem[] = [];
      for (const o of orders) {
        if (usedIds.has(o.id)) continue;
        const who = o.customerId ? cm.get(o.customerId) ?? "Cliente" : "Cliente";
        if (isLab) {
          const cents = Number(o.labCostCents ?? 0n);
          if (cents <= 0) continue;
          items.push({ sourceType, sourceId: o.id, description: `Lente — ${who}`, amountCents: cents });
        } else {
          // repasse do medico: fixo por pedido OU % do valor cobrado
          let cents = 0;
          if (supplier.payoutMode === "percent" && supplier.payoutPercent != null) {
            cents = Math.round(Number(o.customerPriceCents ?? 0n) * (Number(String(supplier.payoutPercent)) / 100));
          } else if (supplier.payoutFixedCents != null) {
            cents = Number(supplier.payoutFixedCents);
          }
          if (cents <= 0) continue;
          items.push({ sourceType, sourceId: o.id, description: `Repasse — ${who}`, amountCents: cents });
        }
      }
      return items;
    });
  }

  async listSettlements(ctx: RequestContext, opts?: { supplierId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplierSettlement.findMany({
        where: { ...(opts?.supplierId ? { supplierId: opts.supplierId } : {}) },
        orderBy: { createdAt: "desc" },
        include: { items: true },
        take: 200,
      }),
    );
  }

  async createSettlement(
    ctx: RequestContext,
    input: {
      supplierId: string;
      periodStart?: string | null;
      periodEnd?: string | null;
      items: Array<{ sourceType: "lens_lab" | "lens_doctor" | "manual" | "production_order"; sourceId?: string | null; description: string; amountCents: number }>;
      notes?: string | null;
    },
  ) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    if (!input.items?.length) throw new AppError(ErrorCode.ValidationFailed, "Sem itens", 400);
    const total = input.items.reduce((s, i) => s + Math.max(0, Math.round(i.amountCents)), 0);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const settlement = await tx.supplierSettlement.create({
        data: {
          organizationId: orgId,
          supplierId: input.supplierId,
          periodStart: input.periodStart ? new Date(input.periodStart) : null,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
          totalCents: BigInt(total),
          status: "pending",
          notes: input.notes ?? null,
          createdByUserId: ctx.userId ?? null,
        },
      });
      for (const it of input.items) {
        await tx.settlementItem.create({
          data: {
            organizationId: orgId,
            settlementId: settlement.id,
            sourceType: it.sourceType,
            sourceId: it.sourceId ?? null,
            description: it.description,
            amountCents: BigInt(Math.max(0, Math.round(it.amountCents))),
          },
        });
      }
      return settlement;
    });
  }

  async paySettlement(
    ctx: RequestContext,
    id: string,
    input: { paymentMethod: string; paymentId?: string | null; proofUrl?: string | null },
  ) {
    this.requireAdmin(ctx);
    await this.getSettlement(ctx, id);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplierSettlement.update({
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

  async getSettlement(ctx: RequestContext, id: string) {
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplierSettlement.findFirst({ where: { id }, include: { items: true } }),
    );
    if (!s) throw new AppError(ErrorCode.NotFound, "Fechamento nao encontrado", 404);
    return s;
  }

  /** Recibo HTML com branding da empresa. */
  async receiptHtml(ctx: RequestContext, id: string): Promise<string> {
    const orgId = this.requireOrg(ctx);
    const data = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const s = await tx.supplierSettlement.findFirst({ where: { id }, include: { items: true } });
      if (!s) throw new AppError(ErrorCode.NotFound, "Fechamento nao encontrado", 404);
      const supplier = await tx.supplier.findFirst({ where: { id: s.supplierId }, select: { name: true, document: true, type: true } });
      const org = await tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true } });
      return { s, supplier, org };
    });
    return buildReceipt({
      brandName: data.org?.name ?? "Empresa",
      logoUrl: data.org?.logoUrl ?? null,
      color: data.org?.primaryColor ?? "#7c3aed",
      supplierName: data.supplier?.name ?? "Fornecedor",
      supplierDoc: data.supplier?.document ?? null,
      settlement: data.s,
    });
  }

  /** Relatorio de lucro real por pedido de lente no periodo. */
  async profit(ctx: RequestContext, opts?: { start?: string; end?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const from = opts?.start ? new Date(opts.start + "T00:00:00Z") : undefined;
      const to = opts?.end ? new Date(opts.end + "T23:59:59Z") : undefined;
      const orders = await tx.lensOrder.findMany({
        where: { ...(from && to ? { createdAt: { gte: from, lte: to } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      const supIds = [...new Set(orders.flatMap((o) => [o.doctorSupplierId, o.labSupplierId]).filter(Boolean))] as string[];
      const sups = supIds.length
        ? await tx.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true, type: true, payoutMode: true, payoutFixedCents: true, payoutPercent: true } })
        : [];
      const sm = new Map(sups.map((s) => [s.id, s]));

      let totRevenue = 0, totLab = 0, totDoctor = 0;
      const rows = orders.map((o) => {
        const revenue = Number(o.customerPriceCents ?? 0n);
        const lab = Number(o.labCostCents ?? 0n);
        let doctor = 0;
        const d = o.doctorSupplierId ? sm.get(o.doctorSupplierId) : null;
        if (d) {
          doctor = d.payoutMode === "percent" && d.payoutPercent != null
            ? Math.round(revenue * (Number(String(d.payoutPercent)) / 100))
            : Number(d.payoutFixedCents ?? 0n);
        }
        const profit = revenue - lab - doctor;
        totRevenue += revenue; totLab += lab; totDoctor += doctor;
        return {
          id: o.id,
          status: o.status,
          createdAt: o.createdAt,
          revenueCents: revenue,
          labCostCents: lab,
          doctorPayoutCents: doctor,
          profitCents: profit,
        };
      });
      return {
        rows,
        totals: {
          revenueCents: totRevenue,
          labCostCents: totLab,
          doctorPayoutCents: totDoctor,
          profitCents: totRevenue - totLab - totDoctor,
        },
      };
    });
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function brl(cents: number | bigint): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildReceipt(opts: {
  brandName: string; logoUrl: string | null; color: string;
  supplierName: string; supplierDoc: string | null; settlement: any;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const s = opts.settlement;
  const header = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${esc(opts.brandName)}</span>`;
  const rows = (s.items ?? [])
    .map((i: any) => `<tr><td style="padding:8px;border:1px solid #ddd">${esc(i.description)}</td><td style="padding:8px;border:1px solid #ddd;text-align:right">${brl(i.amountCents)}</td></tr>`)
    .join("");
  const period = s.periodStart
    ? `${new Date(s.periodStart).toLocaleDateString("pt-BR")} a ${s.periodEnd ? new Date(s.periodEnd).toLocaleDateString("pt-BR") : "—"}`
    : "—";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Recibo</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:720px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:8px}
  h1{font-size:18px;color:${color};margin:16px 0 4px}
  .meta{font-size:13px;color:#555;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:${color};color:#fff;padding:8px;border:1px solid ${color};font-size:12px;text-align:left}
  .total{font-size:18px;font-weight:700;text-align:right;margin-top:12px;color:${color}}
  .status{display:inline-block;font-size:11px;text-transform:uppercase;color:#fff;background:${color};padding:3px 10px;border-radius:999px}
  .toolbar{text-align:center;padding:10px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header>${header}<span class="status">${esc(s.status === "paid" ? "pago" : "pendente")}</span></header>
    <h1>Recibo de repasse</h1>
    <p class="meta">
      Fornecedor: <strong>${esc(opts.supplierName)}</strong>${opts.supplierDoc ? ` · ${esc(opts.supplierDoc)}` : ""}<br/>
      Período: ${esc(period)}<br/>
      ${s.paidAt ? `Pago em: ${new Date(s.paidAt).toLocaleString("pt-BR")}<br/>` : ""}
      ${s.paymentMethod ? `Forma: ${esc(s.paymentMethod)}${s.paymentId ? ` · ID ${esc(s.paymentId)}` : ""}<br/>` : ""}
    </p>
    <table>
      <thead><tr><th>Descrição</th><th style="text-align:right;width:140px">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="total">Total: ${brl(s.totalCents)}</p>
  </div>
</body></html>`;
}
