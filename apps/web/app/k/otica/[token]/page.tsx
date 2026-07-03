"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LiveBall } from "../../LiveBall";

export const dynamic = "force-dynamic";

function brl(c: number) { return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

const STATUS_LABEL: Record<string, string> = {
  pending: "Agendado", confirmed: "Confirmado", checked_in: "Aguardando", started: "Em atendimento",
  done: "Atendido", atendido: "Atendido", finalizado: "Atendido", concluido: "Atendido", no_show: "Faltou",
};
const STATUS_CLS: Record<string, string> = {
  started: "bg-sky-500/30 text-sky-200", checked_in: "bg-amber-400/30 text-amber-100",
  done: "bg-green-500/30 text-green-200", atendido: "bg-green-500/30 text-green-200",
  finalizado: "bg-green-500/30 text-green-200", no_show: "bg-red-500/30 text-red-200",
};

export default function KioskOtica() {
  const params = useParams();
  const token = String((params as any)?.token ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);

  async function load() {
    try {
      const r = await fetch(`/api/kiosk/otica/${token}`, { headers: { "x-no-loading": "1" } });
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
  const agenda: any[] = data.agenda ?? [];

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
          <div><h1 className="text-2xl font-extrabold tracking-tight">{data.org?.name ?? "Painel"}</h1><p className="text-sm text-white/50">Painel da ótica</p></div>
        </div>
        <div className="flex items-center gap-4">
          <LiveBall tick={tick} variant="glasses" />
          <div className="text-right"><p className="text-3xl font-bold tabular-nums">{clock}</p><p className="text-xs text-white/40">atualiza a cada 30s</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Agenda hoje" value={t.agendaHoje ?? 0} cls="text-sky-300" />
        <Kpi label="Atendidos" value={t.atendidos ?? 0} cls="text-green-400" />
        <Kpi label="Faturamento hoje" value={brl(t.faturamentoHoje ?? 0)} cls="text-emerald-300" />
        <Kpi label="Vendas hoje" value={t.vendasHoje ?? 0} />
        <Kpi label="A receber vencido" value={brl(t.aReceberVencido ?? 0)} cls={(t.aReceberVencido ?? 0) > 0 ? "text-red-400" : "text-white"} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5">
        <h2 className="mb-2 text-lg font-bold text-sky-300">🗓️ Agenda de hoje <span className="text-white/40">({agenda.length})</span></h2>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {agenda.length === 0 ? <p className="text-sm text-white/30">Sem agendamentos hoje.</p> : agenda.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5 transition hover:border-white/15 hover:bg-black/30">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 rounded-lg bg-sky-500/20 px-2.5 py-1 text-base font-bold tabular-nums text-sky-100 ring-1 ring-inset ring-sky-400/20">{a.hora}</span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{a.cliente}</p>
                  <p className="truncate text-xs text-white/50">{[a.servico, a.profissional].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[a.status] ?? "bg-white/10 text-white/70"}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
