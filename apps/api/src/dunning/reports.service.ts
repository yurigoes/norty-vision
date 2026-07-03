import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  /** Resumo do crediario: contadores + valores. */
  async creditSummary(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const accounts = await tx.creditAccount.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { limitCents: true, usedCents: true },
      });

      // RLS (via runWithContext) ja escopa por org automaticamente
      const instAgg = await tx.$queryRaw<Array<{ bucket: string; count: bigint; total: bigint }>>`
        SELECT
          CASE
            WHEN status = 'paid' THEN 'paid'
            WHEN status IN ('pending','late') AND due_date < CURRENT_DATE THEN 'overdue'
            WHEN status = 'pending' AND due_date <= CURRENT_DATE + 5 THEN 'due_soon'
            WHEN status = 'pending' THEN 'future'
            ELSE 'other'
          END AS bucket,
          count(*)::bigint AS count,
          COALESCE(sum(amount_cents),0)::bigint AS total
        FROM credit_installments
        GROUP BY 1
      `;

      const buckets: Record<string, { count: number; total: number }> = {};
      for (const r of instAgg) {
        buckets[r.bucket] = { count: Number(r.count), total: Number(r.total) };
      }

      return {
        accounts: accounts.map((a) => ({
          status: a.status,
          count: a._count._all,
          limit: Number(a._sum.limitCents ?? 0),
          used: Number(a._sum.usedCents ?? 0),
        })),
        installments: buckets,
      };
    });
  }

  /** Lista de parcelas filtrada por situacao (em dia / vencidas / a vencer). */
  async installments(ctx: RequestContext, bucket: string) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const where: any = {};
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const soon = new Date(today.getTime() + 5 * 86400_000);
      if (bucket === "overdue") {
        where.status = { in: ["pending", "late"] };
        where.dueDate = { lt: today };
      } else if (bucket === "due_soon") {
        where.status = "pending";
        where.dueDate = { gte: today, lte: soon };
      } else if (bucket === "paid") {
        where.status = "paid";
      } else if (bucket === "future") {
        where.status = "pending";
        where.dueDate = { gt: soon };
      }
      return tx.creditInstallment.findMany({
        where,
        orderBy: { dueDate: "asc" },
        take: 1000,
        include: {
          creditAccount: { select: { id: true, holderName: true, document: true, status: true } },
        },
      });
    });
  }

  /** Relatorio de cobranca: eventos recentes (timeline geral). */
  async collections(ctx: RequestContext, limit = 200) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.dunningEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 1000),
      }),
    );
  }

  // ============================== EXPORT (CSV) ==============================

  /** CSV de parcelas filtradas por situação. */
  async installmentsCsv(ctx: RequestContext, bucket: string): Promise<string> {
    const items = await this.installments(ctx, bucket);
    const header = ["Cliente", "Documento", "Parcela", "Vencimento", "Valor", "Status parcela", "Status conta"];
    const rows = items.map((i: any) => [
      i.creditAccount?.holderName ?? "",
      i.creditAccount?.document ?? "",
      String(i.number),
      new Date(i.dueDate).toLocaleDateString("pt-BR"),
      brlPlain(Number(i.amountCents)),
      i.status,
      i.creditAccount?.status ?? "",
    ]);
    return toCsv([header, ...rows]);
  }

  /** CSV da linha do tempo de cobrança. */
  async collectionsCsv(ctx: RequestContext, limit = 1000): Promise<string> {
    const items = await this.collections(ctx, limit);
    const header = ["Data", "Canal", "Status", "Dias atraso", "Mensagem"];
    const rows = items.map((e: any) => [
      new Date(e.createdAt).toLocaleString("pt-BR"),
      e.channel,
      e.status,
      String(e.daysOverdue),
      e.message ?? "",
    ]);
    return toCsv([header, ...rows]);
  }

  // ============================== PDF (HTML branded) ==============================

  /**
   * Relatório imprimível (PDF via navegador) em 3 modelos:
   * - analitico: lista detalhada de parcelas do filtro
   * - sintetico: totais por situação + contas por status
   * - dashboard: visão executiva com cards e barras
   */
  async reportHtml(
    ctx: RequestContext,
    model: "analitico" | "sintetico" | "dashboard",
    bucket: string,
  ): Promise<string> {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const summary = await this.creditSummary(ctx);
    const brand = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      ctx.orgId
        ? tx.organization.findFirst({ where: { id: ctx.orgId }, select: { name: true, logoUrl: true, primaryColor: true } })
        : Promise.resolve(null),
    );
    const items = model === "analitico" ? await this.installments(ctx, bucket) : [];
    return buildReportHtml({
      brandName: brand?.name ?? "Empresa",
      logoUrl: brand?.logoUrl ?? null,
      color: brand?.primaryColor ?? "#7c3aed",
      model,
      bucket,
      summary,
      items,
    });
  }
}

function brlPlain(cents: number): string {
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}
function brl(cents: number): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: string[][]): string {
  // BOM p/ Excel reconhecer UTF-8; separador ; (pt-BR)
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const BUCKET_LABEL: Record<string, string> = {
  paid: "Pagas", overdue: "Vencidas", due_soon: "A vencer (5d)", future: "Futuras",
};

function buildReportHtml(opts: {
  brandName: string; logoUrl: string | null; color: string;
  model: "analitico" | "sintetico" | "dashboard";
  bucket: string;
  summary: any;
  items: any[];
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${esc(opts.brandName)}</span>`;
  const now = new Date().toLocaleString("pt-BR");
  const inst = opts.summary?.installments ?? {};
  const accounts = opts.summary?.accounts ?? [];

  const titleByModel = {
    analitico: "Relatório analítico — Parcelas",
    sintetico: "Relatório sintético — Crediário & Cobranças",
    dashboard: "Dashboard — Crediário & Cobranças",
  } as const;

  let body = "";

  if (opts.model === "analitico") {
    const rows = opts.items.map((i: any) => `
      <tr>
        <td>${esc(i.creditAccount?.holderName ?? "")}<div style="font-size:11px;color:#888">${esc(i.creditAccount?.document ?? "")}</div></td>
        <td style="text-align:center">${i.number}</td>
        <td>${new Date(i.dueDate).toLocaleDateString("pt-BR")}</td>
        <td style="text-align:right">${brl(Number(i.amountCents))}</td>
        <td>${esc(i.status)}</td>
        <td>${esc(i.creditAccount?.status ?? "")}</td>
      </tr>`).join("");
    const total = opts.items.reduce((s: number, i: any) => s + Number(i.amountCents), 0);
    body = `
      <p class="sub">Filtro: <strong>${esc(BUCKET_LABEL[opts.bucket] ?? opts.bucket)}</strong> · ${opts.items.length} parcela(s)</p>
      <table>
        <thead><tr><th>Cliente</th><th>Parc.</th><th>Vencimento</th><th style="text-align:right">Valor</th><th>Parcela</th><th>Conta</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#888;padding:24px">Nenhuma parcela.</td></tr>`}</tbody>
      </table>
      <p class="total">Total: ${brl(total)}</p>`;
  } else if (opts.model === "sintetico") {
    const bucketRows = Object.keys(BUCKET_LABEL).map((k) => {
      const b = inst[k] ?? { count: 0, total: 0 };
      return `<tr><td>${BUCKET_LABEL[k]}</td><td style="text-align:right">${b.count}</td><td style="text-align:right">${brl(b.total)}</td></tr>`;
    }).join("");
    const accRows = accounts.map((a: any) =>
      `<tr><td>${esc(a.status)}</td><td style="text-align:right">${a.count}</td><td style="text-align:right">${brl(a.limit)}</td><td style="text-align:right">${brl(a.used)}</td></tr>`).join("");
    body = `
      <h2>Parcelas por situação</h2>
      <table>
        <thead><tr><th>Situação</th><th style="text-align:right">Qtde</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${bucketRows}</tbody>
      </table>
      <h2 style="margin-top:24px">Contas por status</h2>
      <table>
        <thead><tr><th>Status</th><th style="text-align:right">Qtde</th><th style="text-align:right">Limite</th><th style="text-align:right">Usado</th></tr></thead>
        <tbody>${accRows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:24px">Sem contas.</td></tr>`}</tbody>
      </table>`;
  } else {
    // dashboard
    const maxTotal = Math.max(1, ...Object.keys(BUCKET_LABEL).map((k) => (inst[k]?.total ?? 0)));
    const cards = Object.keys(BUCKET_LABEL).map((k) => {
      const b = inst[k] ?? { count: 0, total: 0 };
      return `<div class="card"><p class="card-label">${BUCKET_LABEL[k]}</p><p class="card-num">${b.count}</p><p class="card-sub">${brl(b.total)}</p></div>`;
    }).join("");
    const bars = Object.keys(BUCKET_LABEL).map((k) => {
      const b = inst[k] ?? { count: 0, total: 0 };
      const pct = Math.round((b.total / maxTotal) * 100);
      return `<div class="bar-row"><span class="bar-label">${BUCKET_LABEL[k]}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-val">${brl(b.total)}</span></div>`;
    }).join("");
    const totalAccounts = accounts.reduce((s: number, a: any) => s + a.count, 0);
    body = `
      <div class="cards">${cards}</div>
      <h2 style="margin-top:24px">Valor por situação</h2>
      <div class="bars">${bars}</div>
      <p class="sub" style="margin-top:20px">Total de contas de crediário: <strong>${totalAccounts}</strong></p>`;
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${esc(titleByModel[opts.model])}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:820px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px}
  h1{font-size:20px;color:${color};margin:18px 0 2px}
  h2{font-size:14px;color:${color};margin:18px 0 6px}
  .meta{font-size:12px;color:#777}
  .sub{font-size:13px;color:#555;margin:6px 0 12px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th{background:${color};color:#fff;padding:8px;border:1px solid ${color};text-align:left;font-size:12px}
  td{padding:8px;border:1px solid #e5e7eb;vertical-align:top}
  .total{font-size:16px;font-weight:700;text-align:right;margin-top:12px;color:${color}}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
  .card{flex:1;min-width:140px;border:1px solid #e5e7eb;border-radius:12px;padding:14px}
  .card-label{font-size:11px;text-transform:uppercase;color:#888;margin:0}
  .card-num{font-size:28px;font-weight:700;margin:4px 0 0;color:${color}}
  .card-sub{font-size:12px;color:#666;margin:0}
  .bars{margin-top:8px}
  .bar-row{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:12px}
  .bar-label{width:110px;color:#555}
  .bar-track{flex:1;background:#eee;border-radius:999px;height:14px;overflow:hidden}
  .bar-fill{background:${color};height:100%}
  .bar-val{width:120px;text-align:right;color:#333}
  .toolbar{text-align:center;padding:10px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @page{margin:14mm}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header>${header}<span class="meta">${now}</span></header>
    <h1>${esc(titleByModel[opts.model])}</h1>
    ${body}
  </div>
</body></html>`;
}
