"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LiveBall } from "../../LiveBall";

export const dynamic = "force-dynamic";

function brl(c: number) { return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function KioskRecepcao() {
  const params = useParams();
  const token = String((params as any)?.token ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);

  async function load() {
    try {
      const r = await fetch(`/api/kiosk/recepcao/${token}`, { headers: { "x-no-loading": "1" } });
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

  const t = data.totais ?? {};
  const Col = ({ title, items, color, badge }: { title: string; items: any[]; color: string; badge?: (o: any) => string }) => (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
      <h2 className={`mb-2 text-lg font-bold ${color}`}>{title} <span className="text-white/40">({items.length})</span></h2>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {items.length === 0 ? <p className="text-sm text-white/30">—</p> : items.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5 transition hover:border-white/15 hover:bg-black/30">
            <div className="min-w-0"><p className="truncate text-base font-semibold text-white">{o.nome}</p><p className="text-xs text-white/50">{o.code}{o.prazo ? ` · ${o.prazo}` : ""}</p></div>
            {badge && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80 ring-1 ring-inset ring-white/10">{badge(o)}</span>}
          </div>
        ))}
      </div>
    </div>
  );

  const Kpi = ({ label, value, cls }: { label: string; value: any; cls?: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-center shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
      <p className={`text-4xl font-black tabular-nums ${cls ?? "text-white"}`}>{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-white/50">{label}</p>
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
          <div><h1 className="text-2xl font-extrabold tracking-tight">{data.org?.name ?? "Recepção"}</h1><p className="text-sm text-white/50">Painel de recepção</p></div>
        </div>
        <div className="flex items-center gap-4">
          <LiveBall tick={tick} />
          <div className="text-right"><p className="text-3xl font-bold tabular-nums">{clock}</p><p className="text-xs text-white/40">atualiza a cada 30s</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Kpi label="Novos hoje" value={t.novosHoje ?? 0} cls="text-sky-300" />
        <Kpi label="Em aberto" value={t.emAberto ?? 0} />
        <Kpi label="Atrasados" value={t.atrasados ?? 0} cls={(t.atrasados ?? 0) > 0 ? "text-red-400" : "text-white"} />
        <Kpi label="Prazo hoje" value={t.prazoHoje ?? 0} cls="text-amber-300" />
        <Kpi label="Prontos" value={t.prontos ?? 0} cls="text-green-400" />
        <Kpi label="Aguard. arte aprov." value={data.arte?.pendenteAprovacao ?? 0} cls="text-purple-300" />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <Col title="🔴 Atrasados" items={data.atrasados ?? []} color="text-red-400" badge={(o) => o.status} />
        <Col title="🟡 Prazo hoje" items={data.prazoHoje ?? []} color="text-amber-300" badge={(o) => o.status} />
        <Col title="🟢 Prontos" items={data.prontos ?? []} color="text-green-400" badge={(o) => (o.entrega ? "entregar" : "retirar")} />
        <Col title="💰 Pagamento pendente" items={data.pendentesPagamento ?? []} color="text-pink-300" badge={(o) => brl(o.totalCents)} />
      </div>
    </div>
  );
}
