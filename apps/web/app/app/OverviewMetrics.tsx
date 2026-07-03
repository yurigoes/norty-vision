"use client";

import { useEffect, useState } from "react";

interface Overview {
  salesToday: { count: number; totalCents: number };
  appointmentsToday: { count: number };
  noShowRate30d: number | null;
  overdueInstallments: { count: number; totalCents: number };
  openFollowups: number;
  cashOpen: number;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function OverviewMetrics() {
  const [m, setM] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics/overview", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setM(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mt-8 text-sm text-muted">Carregando métricas...</div>;
  if (!m) return null;

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Metric label="Vendas hoje" value={brl(m.salesToday.totalCents)} sub={`${m.salesToday.count} venda(s)`} href="/app/vendas" />
      <Metric label="Agendamentos hoje" value={String(m.appointmentsToday.count)} sub="exames marcados" href="/app/agenda" />
      <Metric
        label="No-show (30d)"
        value={m.noShowRate30d == null ? "—" : `${Math.round(m.noShowRate30d * 100)}%`}
        sub="faltas / atendidos"
        tone={m.noShowRate30d != null && m.noShowRate30d > 0.2 ? "warn" : "default"}
        href="/app/agenda/pendencias"
      />
      <Metric
        label="Parcelas vencidas"
        value={brl(m.overdueInstallments.totalCents)}
        sub={`${m.overdueInstallments.count} parcela(s)`}
        tone={m.overdueInstallments.count > 0 ? "danger" : "default"}
        href="/app/cobranca"
      />
      <Metric label="Pendências abertas" value={String(m.openFollowups)} sub="recontatos" tone={m.openFollowups > 0 ? "warn" : "default"} href="/app/agenda/pendencias" />
      <Metric label="Caixa" value={m.cashOpen > 0 ? "Aberto" : "Fechado"} sub={m.cashOpen > 0 ? `${m.cashOpen} aberto(s)` : "abra no início do dia"} href="/app/caixa" />
    </div>
  );
}

function Metric({ label, value, sub, href, tone = "default" }: {
  label: string; value: string; sub: string; href: string;
  tone?: "default" | "warn" | "danger";
}) {
  const ring = tone === "danger" ? "border-red-500/40" : tone === "warn" ? "border-amber-500/40" : "border-line";
  return (
    <a href={href} className={`block rounded-xl border ${ring} bg-bg/60 p-4 transition hover:border-brand/60`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </a>
  );
}
