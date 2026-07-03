"use client";

// Portal da costureira — relatório de produção. Filtros por período (hoje,
// 7d, 30d, custom) e totais (OSs, peças, valor pago/pendente).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export default function CostureiraRelatorio() {
  const router = useRouter();
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86400_000);
  const [from, setFrom] = useState(isoDate(monthAgo));
  const [to, setTo] = useState(isoDate(today));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await fetch(`/api/supplier-portal/production/report/period?from=${from}&to=${to}`, { credentials: "include" });
      if (r.status === 401) { router.push("/f/login"); return; }
      const d = await r.json();
      setData(d);
      setLoading(false);
    })();
  }, [from, to, router]);

  function setRange(days: number) {
    const t = new Date();
    setTo(isoDate(t));
    setFrom(isoDate(new Date(t.getTime() - days * 86400_000)));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/f" className="text-xs text-muted transition-colors hover:text-fg">← Voltar</Link>
      <h1 className="mt-4 mb-2 text-2xl font-extrabold tracking-tight">Meu relatório</h1>
      <p className="text-xs text-muted">Pedidos que você marcou como prontos no período. Pendentes = ainda não inclusos num pagamento.</p>

      <section className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          <button onClick={() => setRange(0)} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">Hoje</button>
          <button onClick={() => setRange(7)} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">7d</button>
          <button onClick={() => setRange(30)} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">30d</button>
          <button onClick={() => setRange(90)} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium transition hover:border-brand hover:text-brand">90d</button>
        </div>
        <label className="flex flex-col text-[10px] font-semibold uppercase text-muted">de
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base w-auto mt-1 py-1.5" />
        </label>
        <label className="flex flex-col text-[10px] font-semibold uppercase text-muted">até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base w-auto mt-1 py-1.5" />
        </label>
      </section>

      {loading ? (
        <p className="mt-6 text-sm text-muted">Carregando…</p>
      ) : (
        <>
          <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="OSs" value={String(data?.totals?.orders ?? 0)} />
            <Stat label="Peças" value={String(data?.totals?.pieces ?? 0)} />
            <Stat label="A receber" value={brl(data?.totals?.pendingCents ?? 0)} tone="amber" />
            <Stat label="Já pago" value={brl(data?.totals?.paidCents ?? 0)} tone="green" />
          </section>

          <section className="mt-6 space-y-2">
            {(data?.items ?? []).length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted shadow-[var(--shadow-sm)]">Nenhuma OS no período.</p>
            ) : (
              (data.items as any[]).map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                  <div>
                    <p className="font-mono text-sm">#{o.shortCode ?? "—"}</p>
                    <p className="text-[11px] text-muted">{new Date(o.producedAt).toLocaleString("pt-BR")} · {o.pieces} pç</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{brl(o.valueCents)}</p>
                    {o.paid
                      ? <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] uppercase text-green-300">pago</span>
                      : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase text-amber-300">pendente</span>}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  const cls = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : "text-fg";
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-sm)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tracking-tight ${cls}`}>{value}</p>
    </div>
  );
}
