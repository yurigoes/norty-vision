"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LiveBall } from "../../LiveBall";

export const dynamic = "force-dynamic";

export default function KioskProducao() {
  const params = useParams();
  const token = String((params as any)?.token ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);

  async function load() {
    try {
      const r = await fetch(`/api/kiosk/producao/${token}`, { headers: { "x-no-loading": "1" } });
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

  const Card = ({ o }: { o: any }) => (
    <div className={`rounded-xl border px-3 py-2.5 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.6)] transition ${o.atrasado ? "border-red-500/50 bg-red-500/10" : o.prazoHoje ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-black/25 hover:border-white/20"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-base font-bold text-white">{o.nome}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.atrasado ? "bg-red-500/30 text-red-200" : o.prazoHoje ? "bg-amber-400/30 text-amber-100" : "bg-white/10 text-white/70"}`}>
          {o.atrasado ? "atrasado" : o.prazoHoje ? "hoje" : o.dias != null ? (o.dias < 0 ? `${-o.dias}d atrás` : `${o.dias}d`) : "—"}
        </span>
      </div>
      <p className="text-xs text-white/50">{o.code}{o.prazo ? ` · ${o.prazo}` : ""}{o.pecas ? ` · ${o.pecas} pç` : ""}{o.entrega ? " · 🚚 entrega" : ""}</p>
      {o.itens && <p className="mt-0.5 truncate text-xs text-white/70">{o.itens}</p>}
      {o.grade && <p className="mt-0.5 truncate font-mono text-[11px] text-sky-200/80">{o.grade}</p>}
    </div>
  );

  const Kpi = ({ label, value, cls }: { label: string; value: any; cls?: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-center shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
      <p className={`text-4xl font-black tabular-nums ${cls ?? "text-white"}`}>{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-white/50">{label}</p>
    </div>
  );

  const etapas: any[] = data.etapas ?? [];

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
          <div><h1 className="text-2xl font-extrabold tracking-tight">{data.org?.name ?? "Produção"}</h1><p className="text-sm text-white/50">Painel de produção</p></div>
        </div>
        <div className="flex items-center gap-4">
          <LiveBall tick={tick} />
          <div className="text-right"><p className="text-3xl font-bold tabular-nums">{clock}</p><p className="text-xs text-white/40">atualiza a cada 30s</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Em produção" value={t.emProducao ?? 0} cls="text-sky-300" />
        <Kpi label="Peças" value={t.pecas ?? 0} />
        <Kpi label="Atrasados" value={t.atrasados ?? 0} cls={(t.atrasados ?? 0) > 0 ? "text-red-400" : "text-white"} />
        <Kpi label="Prazo hoje" value={t.prazoHoje ?? 0} cls="text-amber-300" />
        <Kpi label="Prontos" value={t.prontos ?? 0} cls="text-green-400" />
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
        {etapas.map((e) => (
          <div key={e.key} className="flex min-h-0 w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
            <h2 className="mb-2 text-lg font-bold text-white">{e.label} <span className="text-white/40">({e.items.length})</span></h2>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {e.items.length === 0 ? <p className="text-sm text-white/30">—</p> : e.items.map((o: any) => <Card key={o.id} o={o} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
