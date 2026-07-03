"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Presence = { membershipId: string; name: string; status: string; maxConcurrent: number; activeCount: number; lastSeenAt: string | null };
type Row = { id: string; name: string; count: number };
type Report = { total: number; byTabulation: Row[]; byAgent: Row[] };

const STATUS_LABEL: Record<string, string> = { online: "Disponível", paused: "Pausado", offline: "Offline" };
const STATUS_DOT: Record<string, string> = { online: "bg-green-400", paused: "bg-amber-400", offline: "bg-zinc-500" };

export default function SupervisorPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [rep, setRep] = useState<Report | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    fetch("/api/inbox/presence", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => { if (r.status === 403) { setForbidden(true); return null; } return r.ok ? r.json() : null; })
      .then((d) => d && setPresence(d.items ?? [])).catch(() => {});
    fetch(`/api/inbox/reports/tabulations?from=${today}&to=${today}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setRep(d)).catch(() => {});
  }, [today]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const maxAg = Math.max(1, ...(rep?.byAgent.map((r) => r.count) ?? [1]));
  const fmtSeen = (s: string | null) => (s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");

  if (forbidden) {
    return (
      <div className="max-w-2xl">
        <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
        <p className="mt-6 rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Apenas supervisores (admin da empresa) acessam este painel.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
        <h1 className="mt-1 text-2xl font-semibold">Supervisão do call center</h1>
        <p className="text-sm text-muted">Quem está online, pausado ou offline — e quem está atendendo mais hoje.</p>
      </header>

      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <h2 className="mb-3 text-sm font-semibold">Operadores ({presence.filter((p) => p.status === "online").length} disponíveis)</h2>
        <div className="space-y-1">
          {presence.length === 0 ? <p className="text-xs text-muted">Nenhum operador.</p> : presence.map((p) => (
            <div key={p.membershipId} className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[p.status] ?? "bg-zinc-500"}`} />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted">{STATUS_LABEL[p.status] ?? p.status}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-muted">
                <span>visto {fmtSeen(p.lastSeenAt)}</span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${p.activeCount >= p.maxConcurrent ? "bg-red-500/20 text-red-300" : "bg-line text-fg"}`}>{p.activeCount}/{p.maxConcurrent}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
        <h2 className="mb-1 text-sm font-semibold">Atendimentos finalizados hoje</h2>
        <p className="mb-3 text-xs text-muted">Total: <strong>{rep?.total ?? 0}</strong></p>
        {(rep?.byAgent.length ?? 0) === 0 ? <p className="text-xs text-muted">Ninguém finalizou atendimentos hoje ainda.</p> : rep!.byAgent.map((r) => (
          <div key={r.id} className="mb-2">
            <div className="flex items-center justify-between text-xs"><span>{r.name}</span><span className="text-muted">{r.count}</span></div>
            <div className="mt-1 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-green-500/70" style={{ width: `${(r.count / maxAg) * 100}%` }} /></div>
          </div>
        ))}
      </section>
    </div>
  );
}
