"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
const BRAND = "rgb(var(--brand))";

function brl(c: number): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function brlShort(c: number): string { const v = Number(c) / 100; return v >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${v.toFixed(0)}`; }

const PAY_LABEL: Record<string, string> = { cash: "Dinheiro", pix: "Pix", card_full: "Cartão à vista", card_installments: "Cartão parcelado", credit: "Crediário", debit: "Débito" };

export default function PainelOtica() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [niche, setNiche] = useState<string | null | undefined>(undefined);

  useEffect(() => { fetch("/api/organizations/me", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setNiche(d?.organization?.niche ?? null)).catch(() => setNiche(null)); }, []);
  useEffect(() => {
    if (niche !== undefined && niche !== "otica") return;
    setLoading(true);
    fetch(`/api/metrics/otica?days=${days}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [days, niche]);

  if (niche !== undefined && niche !== "otica") {
    return (
      <main className="max-w-2xl">
        <div className="card p-8 text-center">
          <h1 className="text-2xl font-semibold">Painel de BI da ótica</h1>
          <p className="mt-2 text-muted">Este acompanhamento (agenda, exames) é específico do nicho ótica. Para a gráfica, use <a href="/app/producao" className="text-brand hover:underline">Produção / Pedidos</a> (aba Financeiro) e os painéis de TV em Configuração › Lojas.</p>
        </div>
      </main>
    );
  }

  const a = data?.agenda; const s = data?.sales; const f = data?.financeiro; const fc = data?.forecast;
  const trend = (data?.trend ?? []).map((t: any) => ({ ...t, label: t.week.slice(5) }));

  return (
    <main className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Painel · Ótica</p>
          <h1 className="mt-1 text-3xl font-semibold">Acompanhamento</h1>
          <p className="mt-1 text-muted">Agenda, vendas e projeção — atualiza em tempo real.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-1 text-sm">
          {[30, 90, 180].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 ${days === d ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>{d}d</button>
          ))}
        </div>
      </header>

      {loading && !data ? <p className="text-sm text-muted">Carregando…</p> : !data ? <p className="text-sm text-muted">Sem dados.</p> : (
        <>
          {/* KPIs financeiros — Faturamento do período acompanha o seletor (30/90/180) */}
          <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi title={`Faturamento (${days} dias)`} value={brl(s.revenueCents)} highlight />
            <Kpi title="Vendas hoje" value={brl(f.revTodayCents)} />
            <Kpi title="Vendas (7 dias)" value={brl(f.revWeekCents)} />
            <Kpi title="Ticket médio" value={brl(s.ticketMedioCents)} />
          </div>
          {Number(s?.historicalRevenueCents) > 0 && (
            <p className="mb-6 text-xs text-muted">O faturamento de {days} dias inclui <b>{brl(s.historicalRevenueCents)}</b> de vendas históricas importadas (até a 1ª venda no sistema novo). Ticket médio considera só vendas do sistema novo.</p>
          )}

          {/* Agenda */}
          <Section title="Agenda">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi title="Horários abertos" value={String(a.slotsOpen)} sub={`de ${a.slotsCapacity}`} />
              <Kpi title="Ocupação" value={a.occupancyRate != null ? `${a.occupancyRate}%` : "—"} />
              <Kpi title="Confirmados" value={String(a.confirmed)} tone="green" />
              <Kpi title="A confirmar" value={String(a.pending)} tone="amber" />
              <Kpi title="Cancelados" value={String(a.canceled)} tone="red" />
              <Kpi title="No-show" value={String(a.noShow)} tone="red" />
            </div>
          </Section>

          {/* Tendência de receita */}
          <Section title="Receita por semana (12 semanas)">
            {trend.length === 0 ? <Empty /> : (
              <ChartBox h={240}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.4)" />
                  <YAxis tickFormatter={(v) => brlShort(v)} tick={{ fontSize: 11 }} width={56} stroke="rgba(255,255,255,0.4)" />
                  <Tooltip formatter={(v: any) => brl(Number(v))} labelFormatter={(l) => `Semana ${l}`} contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenueCents" name="Receita" stroke={BRAND} strokeWidth={2} fill="url(#rev)" />
                </AreaChart>
              </ChartBox>
            )}
          </Section>

          {/* Previsão */}
          {fc && (
            <Section title="Projeção de vendas">
              <div className="grid gap-3 sm:grid-cols-3">
                <Kpi title="Próxima semana" value={brl(fc.nextWeekCents)} highlight />
                <Kpi title="Próximo mês" value={brl(fc.nextMonthCents)} />
                <Kpi title="Próximo trimestre" value={brl(fc.nextQuarterCents)} />
              </div>
              <p className="mt-2 text-[11px] text-muted">Base: {fc.method}.</p>
              {data.aiInsight && (
                <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">Leitura da IA</p>
                  <p className="mt-1 text-sm leading-relaxed">{data.aiInsight}</p>
                </div>
              )}
            </Section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top produtos */}
            <Section title={`Mais vendidos (${s.glassesSold} itens)`}>
              {s.topProducts.length === 0 ? <Empty /> : (
                <ChartBox h={Math.max(180, s.topProducts.length * 34)}>
                  <BarChart layout="vertical" data={s.topProducts.slice(0, 8)} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.5)" />
                    <Tooltip formatter={(v: any, n: any) => (n === "qty" ? [`${v} un`, "Qtd"] : [brl(Number(v)), "Receita"])} contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="qty" name="qty" radius={[0, 4, 4, 0]}>
                      {s.topProducts.slice(0, 8).map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Bar>
                  </BarChart>
                </ChartBox>
              )}
            </Section>

            {/* Grupos (categoria) */}
            <Section title="Grupos que mais vendem">
              {s.topCategories.length === 0 ? <Empty /> : (
                <ChartBox h={240}>
                  <PieChart>
                    <Pie data={s.topCategories} dataKey="qty" nameKey="category" cx="50%" cy="50%" outerRadius={90} label={(e: any) => e.category}>
                      {s.topCategories.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} un`, "Qtd"]} contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ChartBox>
              )}
            </Section>
          </div>

          {/* Meios de pagamento */}
          <Section title="Por meio de pagamento">
            {s.byPaymentMethod.length === 0 ? <Empty /> : (
              <div className="flex flex-wrap gap-2">
                {s.byPaymentMethod.sort((x: any, y: any) => y.totalCents - x.totalCents).map((p: any, i: number) => (
                  <span key={p.method} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm" style={{ borderColor: PALETTE[i % PALETTE.length] }}>
                    {PAY_LABEL[p.method] ?? p.method}: <b>{brl(p.totalCents)}</b>
                  </span>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ChartBox({ h, children }: { h: number; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3" style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Kpi({ title, value, sub, highlight, tone }: { title: string; value: string; sub?: string; highlight?: boolean; tone?: "green" | "amber" | "red" }) {
  const toneClass = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : tone === "red" ? "text-red-300" : highlight ? "text-brand" : "";
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-brand/40 bg-brand/10" : "border-line bg-surface-2"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{title}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Empty() { return <p className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-muted">Sem dados no período.</p>; }
