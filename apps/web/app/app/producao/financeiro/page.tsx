"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

function brl(c: number | string): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function todayMinus(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }

interface Fin {
  producao: { pedidos: number; cancelados: number; faturamentoCents: number; recebidoCents: number; aReceberCents: number; porStatus: Array<{ status: string; label: string; count: number; valueCents: number }> };
  orcamentos: { total: number; convertidos: number; viaIa: number; taxaConversao: number; valorTotalCents: number };
}

export default function ProducaoFinanceiro() {
  const [from, setFrom] = useState(todayMinus(30));
  const [to, setTo] = useState(todayMinus(0));
  const [fin, setFin] = useState<Fin | null>(null);

  const load = useCallback(() => {
    fetch(`/api/production/financeiro?start=${from}&end=${to}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setFin(d)).catch(() => {});
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const p = fin?.producao;
  const o = fin?.orcamentos;
  const maxStatus = Math.max(1, ...(p?.porStatus.map((s) => s.valueCents) ?? [1]));

  return (
    <div className="max-w-4xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/app/producao" className="text-sm text-brand hover:underline">← Produção</Link>
          <h1 className="mt-1 text-2xl font-semibold">Financeiro da gráfica</h1>
          <p className="text-sm text-muted">Faturamento, recebido e a receber dos pedidos de produção no período.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="block"><span className="block text-[10px] uppercase text-muted">De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5" /></label>
          <label className="block"><span className="block text-[10px] uppercase text-muted">Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5" /></label>
          <a href={`/api/production/financeiro/export?format=pdf&start=${from}&end=${to}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 hover:border-brand">PDF</a>
          <a href={`/api/production/financeiro/export?format=csv&start=${from}&end=${to}`} className="rounded-lg border border-line px-3 py-2 hover:border-brand">CSV</a>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card label="Faturamento" value={brl(p?.faturamentoCents ?? 0)} hint={`${p?.pedidos ?? 0} pedido(s)`} />
        <Card label="Recebido" value={brl(p?.recebidoCents ?? 0)} tone="green" />
        <Card label="A receber" value={brl(p?.aReceberCents ?? 0)} tone="amber" />
        <Card label="Cancelados" value={String(p?.cancelados ?? 0)} tone="muted" />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
        <h2 className="mb-3 text-sm font-semibold">Pedidos por etapa (valor)</h2>
        {(p?.porStatus.length ?? 0) === 0 ? <p className="text-xs text-muted">Sem pedidos no período.</p> : p!.porStatus.map((s) => (
          <div key={s.status} className="mb-2">
            <div className="flex items-center justify-between text-xs"><span>{s.label} <span className="text-muted">· {s.count}</span></span><span className="text-muted">{brl(s.valueCents)}</span></div>
            <div className="mt-1 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-brand" style={{ width: `${(s.valueCents / maxStatus) * 100}%` }} /></div>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
        <h2 className="mb-3 text-sm font-semibold">Orçamentos no período</h2>
        <div className="grid gap-4 sm:grid-cols-4 text-sm">
          <div><p className="text-[10px] uppercase text-muted">Total</p><p className="text-lg font-semibold">{o?.total ?? 0}</p></div>
          <div><p className="text-[10px] uppercase text-muted">Viraram pedido</p><p className="text-lg font-semibold">{o?.convertidos ?? 0}</p></div>
          <div><p className="text-[10px] uppercase text-muted">Taxa de conversão</p><p className="text-lg font-semibold">{o?.taxaConversao ?? 0}%</p></div>
          <div><p className="text-[10px] uppercase text-muted">Criados pela IA</p><p className="text-lg font-semibold">{o?.viaIa ?? 0}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-muted">Valor total orçado no período: <b>{brl(o?.valorTotalCents ?? 0)}</b>.</p>
      </section>
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "amber" | "muted" }) {
  const cls = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-200" : tone === "muted" ? "text-muted" : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
