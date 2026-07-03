"use client";

import { useEffect, useState } from "react";

interface Insight { id: string; kind: string; severity: string; title: string; detail: string | null; }

const SEV: Record<string, string> = { urgent: "border-red-500/50 bg-red-500/5", warn: "border-amber-500/40 bg-amber-500/5", info: "border-line bg-bg/60" };
const SEV_TAG: Record<string, string> = { urgent: "bg-red-500/20 text-red-300", warn: "bg-amber-500/20 text-amber-200", info: "bg-line text-muted" };

export function InsightsClient() {
  const [items, setItems] = useState<Insight[] | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/insights", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.items ?? []))
      .catch(() => setItems([]));
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    try {
      await fetch("/api/insights/refresh", { method: "POST", credentials: "include" });
      load();
    } finally { setBusy(false); }
  }
  async function dismiss(id: string) {
    await fetch(`/api/insights/${id}/dismiss`, { method: "POST", credentials: "include" });
    setItems((it) => (it ?? []).filter((x) => x.id !== id));
  }

  if (!items) return <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Carregando…</p>;

  const resumo = items.find((i) => i.kind === "resumo");
  const gargalos = items.filter((i) => i.kind !== "resumo");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{gargalos.length} ponto(s) de atenção</p>
        <button onClick={refresh} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand disabled:opacity-50">{busy ? "Analisando…" : "Analisar agora"}</button>
      </div>

      {resumo?.detail && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Resumo da IA</p>
          <p className="mt-1 text-sm">{resumo.detail}</p>
        </div>
      )}

      {gargalos.length === 0 ? (
        <p className="rounded-xl border border-green-500/30 bg-green-500/5 p-6 text-center text-sm text-green-300">Tudo em ordem — nenhum gargalo detectado ✅</p>
      ) : (
        <div className="space-y-2">
          {gargalos.map((i) => (
            <div key={i.id} className={`flex items-start justify-between gap-3 rounded-xl border p-4 ${SEV[i.severity] ?? SEV.info}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEV_TAG[i.severity] ?? SEV_TAG.info}`}>{i.severity === "urgent" ? "Urgente" : i.severity === "warn" ? "Atenção" : "Info"}</span>
                  <p className="text-sm font-medium">{i.title}</p>
                </div>
                {i.detail && <p className="mt-1 text-xs text-muted">{i.detail}</p>}
              </div>
              <button onClick={() => dismiss(i.id)} className="shrink-0 text-[11px] text-muted hover:text-fg">dispensar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
