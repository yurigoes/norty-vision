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

  if (err) return <div className="flex min-h-screen items-center justify-center bg-[#0b1020] text-2xl text-red-300">{err}</div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-[#0b1020] text-2xl text-slate-400">Carregando painel…</div>;

  const t = data.totais ?? {};
  const agenda: any[] = data.agenda ?? [];

  const Kpi = ({ label, value, cls }: { label: string; value: any; cls?: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center">
      <p className={`text-4xl font-black ${cls ?? "text-white"}`}>{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-white/50">{label}</p>
    </div>
  );

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden bg-[#0b1020] p-5 text-white">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {data.org?.logoUrl && <img src={data.org.logoUrl} alt="" className="h-12 w-auto object-contain" />}
          <div><h1 className="text-2xl font-bold">{data.org?.name ?? "Painel"}</h1><p className="text-sm text-white/50">Painel da ótica</p></div>
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

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-2 text-lg font-bold text-sky-300">🗓️ Agenda de hoje <span className="text-white/40">({agenda.length})</span></h2>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {agenda.length === 0 ? <p className="text-sm text-white/30">Sem agendamentos hoje.</p> : agenda.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-base font-bold tabular-nums text-white">{a.hora}</span>
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
