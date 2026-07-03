"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LiveBall } from "../../LiveBall";

export const dynamic = "force-dynamic";

function brl(c: number) { return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function KioskAdmin() {
  const params = useParams();
  const token = String((params as any)?.token ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);

  async function load() {
    try {
      const r = await fetch(`/api/kiosk/admin/${token}`, { headers: { "x-no-loading": "1" } });
      if (!r.ok) { setErr("Painel não encontrado ou token inválido."); return; }
      setErr(null); setData(await r.json()); setTick((t) => t + 1);
    } catch { setErr("Sem conexão."); }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    const c = setInterval(() => setClock(new Date().toLocaleTimeString("pt-BR")), 1000);
    return () => { clearInterval(t); clearInterval(c); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (err) return <div className="flex min-h-screen items-center justify-center bg-[#060a15] text-2xl text-red-300">{err}</div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-[#060a15] text-2xl text-slate-400">Carregando painel…</div>;

  const fin = data.financeiro ?? {};
  const c = data.contas ?? {};
  const prod = data.producao ?? {};
  const pend = data.pendencias ?? {};
  const listas = data.listas ?? {};

  const Kpi = ({ label, value, cls, sub }: { label: string; value: any; cls?: string; sub?: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
      <p className="text-xs font-medium uppercase tracking-wider text-white/50">{label}</p>
      <p className={`mt-1 text-3xl font-black tabular-nums ${cls ?? "text-white"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );

  const List = ({ title, items, color, right }: { title: string; items: any[]; color: string; right: (o: any) => any }) => (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
      <h2 className={`mb-2 text-lg font-bold ${color}`}>{title} <span className="text-white/40">({items.length})</span></h2>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {items.length === 0 ? <p className="text-sm text-white/30">—</p> : items.map((o, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5 transition hover:border-white/15 hover:bg-black/30">
            <div className="min-w-0"><p className="truncate text-base font-semibold text-white">{o.nome}</p><p className="text-xs text-white/50">{o.venc ?? o.code ?? ""}{o.status ? ` · ${o.status}` : ""}</p></div>
            <span className="shrink-0 text-sm font-semibold text-white/90">{right(o)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="flex h-screen flex-col gap-4 overflow-hidden p-5 text-white"
      style={{
        background:
          "radial-gradient(900px 520px at 82% -6%, rgba(37,99,235,.20), transparent 60%), radial-gradient(760px 520px at 6% 106%, rgba(6,182,212,.14), transparent 58%), linear-gradient(180deg, #060a15 0%, #080d1a 100%)",
      }}
    >
      <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 ring-1 ring-inset ring-white/5">
        <div className="flex items-center gap-3">
          {data.org?.logoUrl && <img src={data.org.logoUrl} alt="" className="h-12 w-auto object-contain" />}
          <div><h1 className="text-2xl font-extrabold tracking-tight">{data.org?.name ?? "Painel"}</h1><p className="text-sm text-white/50">Painel geral</p></div>
        </div>
        <div className="flex items-center gap-4">
          <LiveBall tick={tick} />
          <div className="text-right"><p className="text-3xl font-bold tabular-nums">{clock}</p><p className="text-xs text-white/40">atualiza a cada 30s</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Faturamento hoje" value={brl(fin.faturamentoHoje ?? 0)} cls="text-green-400" sub={`${fin.vendasHoje ?? 0} vendas`} />
        <Kpi label="Faturamento mês" value={brl(fin.faturamentoMes ?? 0)} cls="text-emerald-300" sub={`${fin.vendasMes ?? 0} vendas`} />
        <Kpi label="A receber" value={brl(c.aReceberTotal ?? 0)} cls="text-sky-300" sub={`${c.aReceberVencidos ?? 0} vencidos · ${brl(c.aReceberVencidoTotal ?? 0)}`} />
        <Kpi label="A pagar" value={brl(c.aPagarTotal ?? 0)} cls="text-pink-300" sub={`${c.aPagarVencidos ?? 0} vencidos · ${brl(c.aPagarVencidoTotal ?? 0)}`} />
        <Kpi label="Saldo previsto" value={brl(c.saldoPrevisto ?? 0)} cls={(c.saldoPrevisto ?? 0) >= 0 ? "text-green-400" : "text-red-400"} />
        <Kpi label="Pedidos em aberto" value={prod.emAberto ?? 0} sub={`${prod.atrasados ?? 0} atrasados · ${prod.prazoHoje ?? 0} hoje`} cls={(prod.atrasados ?? 0) > 0 ? "text-amber-300" : "text-white"} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Prontos" value={prod.prontos ?? 0} cls="text-green-400" />
        <Kpi label="Arte p/ aprovar" value={pend.arteAprovacao ?? 0} cls="text-purple-300" />
        <Kpi label="Pagamento pedido pend." value={pend.pagamentoPedido ?? 0} cls="text-amber-300" />
        <Kpi label="Contas vencidas" value={(c.aPagarVencidos ?? 0) + (c.aReceberVencidos ?? 0)} cls={((c.aPagarVencidos ?? 0) + (c.aReceberVencidos ?? 0)) > 0 ? "text-red-400" : "text-white"} />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <List title="💸 A pagar" items={listas.aPagar ?? []} color="text-pink-300" right={(o) => <span className={o.vencido ? "text-red-400" : ""}>{brl(o.valorCents)}</span>} />
        <List title="💰 A receber" items={listas.aReceber ?? []} color="text-sky-300" right={(o) => <span className={o.vencido ? "text-amber-300" : ""}>{brl(o.valorCents)}</span>} />
        <List title="📋 Pedidos a atenção" items={listas.pedidos ?? []} color="text-amber-300" right={(o) => brl(o.totalCents)} />
      </div>
    </div>
  );
}
