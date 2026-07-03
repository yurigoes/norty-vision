"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; name: string; count: number };
type Report = { total: number; byTabulation: Row[]; byAgent: Row[] };
type Tab = { id: string; name: string; groupName: string | null };
type Overview = { totals: { total: number; abertas: number; resolvidas: number; bot: number; aguardando: number }; avgFirstResponseS: number | null; avgResolutionS: number | null; csat: { npsAvg: number | null; npsCount: number; sellerAvg: number | null; sellerCount: number } };
type AgentRow = { membershipId: string; name: string; atendimentos: number; avgFirstResponseS: number | null; avgResolutionS: number | null; csatAvg: number | null; csatCount: number };
type VolumeRow = { key: string; count: number };

function todayMinus(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function fmtSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}

export default function AtendimentoRelatorios() {
  const [from, setFrom] = useState(todayMinus(30));
  const [to, setTo] = useState(todayMinus(0));
  const [rep, setRep] = useState<Report | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [newTab, setNewTab] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [org, setOrg] = useState<{ name: string; logoUrl: string | null } | null>(null);
  // PR6: overview + ranking + volume
  const [ov, setOv] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [volume, setVolume] = useState<VolumeRow[]>([]);
  const [volGroup, setVolGroup] = useState<"hour" | "day">("hour");

  const load = useCallback(() => {
    fetch(`/api/inbox/reports/tabulations?from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setRep(d)).catch(() => {});
    fetch(`/api/inbox/reports/overview?from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setOv(d)).catch(() => {});
    fetch(`/api/inbox/reports/by-agent?from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setAgents(d?.items ?? [])).catch(() => {});
    fetch(`/api/inbox/reports/volume?from=${from}&to=${to}&groupBy=${volGroup}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setVolume(d?.items ?? [])).catch(() => {});
  }, [from, to, volGroup]);
  const loadTabs = useCallback(() => {
    fetch("/api/inbox/tabulations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setTabs(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTabs(); }, [loadTabs]);
  useEffect(() => {
    fetch("/api/organizations/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.organization && setOrg(d.organization)).catch(() => {});
  }, []);
  const periodLabel = `${new Date(from + "T00:00:00").toLocaleDateString("pt-BR")} a ${new Date(to + "T00:00:00").toLocaleDateString("pt-BR")}`;

  async function addTab() {
    if (!newTab.trim()) return;
    const res = await fetch("/api/inbox/tabulations", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ name: newTab.trim(), groupName: newGroup.trim() || undefined }),
    });
    if (res.ok) { setNewTab(""); setNewGroup(""); loadTabs(); }
  }

  const maxTab = Math.max(1, ...(rep?.byTabulation.map((r) => r.count) ?? [1]));
  const maxAg = Math.max(1, ...(rep?.byAgent.map((r) => r.count) ?? [1]));

  return (
    <div className="max-w-4xl">
      <style dangerouslySetInnerHTML={{ __html: "@media print { @page { margin: 0; } html, body { background:#fff !important; } .no-print { display:none !important; } .print-only { display:block !important; } .print-report { padding: 14mm !important; } }" }} />
      <header className="no-print mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
          <h1 className="mt-1 text-3xl font-semibold">Relatórios de atendimento</h1>
          <p className="mt-2 text-muted">Tabulações no período — onde está o gargalo.</p>
        </div>
        <div className="flex items-end gap-2 text-sm">
          <label className="block"><span className="block text-[10px] uppercase text-muted">De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base mt-1 w-auto" /></label>
          <label className="block"><span className="block text-[10px] uppercase text-muted">Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base mt-1 w-auto" /></label>
          <button onClick={() => window.print()} className="btn-grad">🖨️ PDF / Imprimir</button>
        </div>
      </header>

      {/* Versão branded só pra impressão / PDF */}
      <div className="print-only hidden">
        <div className="print-report bg-white p-8 text-black">
          <header className="mb-6 flex items-center justify-between border-b border-gray-300 pb-4">
            <div>
              <h1 className="text-xl font-bold">{org?.name ?? "Atendimento"}</h1>
              <p className="text-sm text-gray-600">Relatório de atendimento (call center)</p>
              <p className="text-sm font-medium">Período: {periodLabel}</p>
            </div>
            {org?.logoUrl && <img src={org.logoUrl} alt="" className="h-14 w-auto max-w-[160px] object-contain" />}
          </header>
          <p className="mb-4 text-sm">Total de atendimentos finalizados e tabulados: <strong>{rep?.total ?? 0}</strong></p>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h2 className="mb-2 text-sm font-bold">Por motivo (tabulação)</h2>
              <table className="w-full text-sm"><tbody>
                {(rep?.byTabulation ?? []).map((r) => (<tr key={r.id} className="border-b border-gray-200"><td className="py-1">{r.name}</td><td className="py-1 text-right font-medium">{r.count}</td></tr>))}
                {(rep?.byTabulation.length ?? 0) === 0 && <tr><td className="py-2 text-gray-500">Sem dados.</td></tr>}
              </tbody></table>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-bold">Por atendente</h2>
              <table className="w-full text-sm"><tbody>
                {(rep?.byAgent ?? []).map((r) => (<tr key={r.id} className="border-b border-gray-200"><td className="py-1">{r.name}</td><td className="py-1 text-right font-medium">{r.count}</td></tr>))}
                {(rep?.byAgent.length ?? 0) === 0 && <tr><td className="py-2 text-gray-500">Sem dados.</td></tr>}
              </tbody></table>
            </div>
          </div>
          <p className="mt-6 text-right text-xs text-gray-500">Emitido em {new Date().toLocaleString("pt-BR")}</p>
        </div>
      </div>

      <p className="no-print card mb-4 text-sm">
        Total de atendimentos finalizados e tabulados: <strong>{rep?.total ?? 0}</strong>
      </p>

      {/* Visão geral (PR6) */}
      <section className="no-print card mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Visão geral</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Atendimentos" value={String(ov?.totals.total ?? 0)} />
          <Stat label="Resolvidas" value={String(ov?.totals.resolvidas ?? 0)} />
          <Stat label="Abertas agora" value={String(ov?.totals.abertas ?? 0)} />
          <Stat label="Aguardando" value={String(ov?.totals.aguardando ?? 0)} tone="amber" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="1ª resposta (média)" value={fmtSec(ov?.avgFirstResponseS ?? null)} tone="sky" />
          <Stat label="Tempo até resolver (média)" value={fmtSec(ov?.avgResolutionS ?? null)} tone="sky" />
          <Stat label={`Satisfação (${ov?.csat.npsCount ?? 0} respostas)`} value={ov?.csat.npsAvg != null ? `${ov.csat.npsAvg.toFixed(1)} ⭐` : "—"} tone="green" />
        </div>
      </section>

      {/* Ranking por operador (PR6) */}
      <section className="no-print card mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Ranking por operador</h2>
        {agents.length === 0 ? <p className="text-xs text-muted">Sem dados no período.</p> : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-muted">
              <tr><th className="py-1 text-left">Operador</th><th className="text-right">Atend.</th><th className="text-right">1ª resp</th><th className="text-right">Resolver</th><th className="text-right">CSAT</th></tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.membershipId} className="border-t border-line">
                  <td className="py-1">{a.name}</td>
                  <td className="text-right font-medium">{a.atendimentos}</td>
                  <td className="text-right text-muted">{fmtSec(a.avgFirstResponseS)}</td>
                  <td className="text-right text-muted">{fmtSec(a.avgResolutionS)}</td>
                  <td className="text-right">{a.csatAvg != null ? `${a.csatAvg.toFixed(1)}⭐ (${a.csatCount})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Volume por hora/dia (PR6) */}
      <section className="no-print card mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Volume de mensagens recebidas</h2>
          <div className="flex gap-1">
            <button onClick={() => setVolGroup("hour")} className={`rounded-md px-2 py-1 text-xs transition ${volGroup === "hour" ? "bg-brand/15 text-brand" : "text-muted hover:text-fg"}`}>Por hora</button>
            <button onClick={() => setVolGroup("day")} className={`rounded-md px-2 py-1 text-xs transition ${volGroup === "day" ? "bg-brand/15 text-brand" : "text-muted hover:text-fg"}`}>Por dia</button>
          </div>
        </div>
        {volume.length === 0 ? <p className="text-xs text-muted">Sem mensagens no período.</p> : (
          <div className="flex items-end gap-1 overflow-x-auto">
            {(() => {
              const max = Math.max(1, ...volume.map((v) => v.count));
              return volume.map((v) => (
                <div key={v.key} className="flex w-8 flex-col items-center text-[10px]" title={`${v.key}: ${v.count}`}>
                  <div className="w-full rounded-t bg-brand/70" style={{ height: `${(v.count / max) * 100}px` }} />
                  <span className="mt-1 text-muted">{v.key}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </section>

      <div className="no-print grid gap-6 sm:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold">Por motivo (tabulação)</h2>
          {(rep?.byTabulation.length ?? 0) === 0 ? <p className="text-xs text-muted">Sem dados no período.</p> : rep!.byTabulation.map((r) => (
            <div key={r.id} className="mb-2">
              <div className="flex items-center justify-between text-xs"><span>{r.name}</span><span className="text-muted">{r.count}</span></div>
              <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${(r.count / maxTab) * 100}%` }} /></div>
            </div>
          ))}
        </section>
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold">Por atendente</h2>
          {(rep?.byAgent.length ?? 0) === 0 ? <p className="text-xs text-muted">Sem dados no período.</p> : rep!.byAgent.map((r) => (
            <div key={r.id} className="mb-2">
              <div className="flex items-center justify-between text-xs"><span>{r.name}</span><span className="text-muted">{r.count}</span></div>
              <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-success/70" style={{ width: `${(r.count / maxAg) * 100}%` }} /></div>
            </div>
          ))}
        </section>
      </div>

      <section className="no-print card mt-6">
        <h2 className="mb-3 text-sm font-semibold">Tabulações cadastradas</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <input value={newTab} onChange={(e) => setNewTab(e.target.value)} placeholder="Nova tabulação (motivo)" className="input-base flex-1" />
          <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Grupo (opcional)" className="input-base w-40" />
          <button onClick={addTab} className="btn-grad">Adicionar</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <span key={t.id} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs">{t.groupName ? `${t.groupName} · ` : ""}{t.name}</span>
          ))}
          {tabs.length === 0 && <p className="text-xs text-muted">Nenhuma tabulação ainda. Cadastre os motivos que sua equipe usa.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "sky" }) {
  const cls = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : tone === "sky" ? "text-sky-300" : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
