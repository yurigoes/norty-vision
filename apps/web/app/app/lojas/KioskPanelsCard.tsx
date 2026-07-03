"use client";

import { useEffect, useState } from "react";

type Panel = { kind: string; label: string; desc: string };

const ALL: Panel[] = [
  { kind: "admin", label: "Painel geral (admin)", desc: "Visão geral: faturamento, a receber, a pagar, produção e pendências." },
  { kind: "recepcao", label: "Recepção (gráfica)", desc: "Atrasados, prazo de hoje, prontos e pagamento pendente." },
  { kind: "producao", label: "Produção (gráfica)", desc: "Pedidos por etapa de produção, com grade e prioridade por prazo." },
  { kind: "otica", label: "Painel da ótica", desc: "Agenda do dia, atendimentos e financeiro do dia." },
];

export function KioskPanelsCard({ niche }: { niche?: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const panels = ALL.filter((p) => {
    if (p.kind === "admin") return true;
    if (p.kind === "recepcao" || p.kind === "producao") return niche === "grafica";
    if (p.kind === "otica") return niche === "otica";
    return false;
  });

  async function ensureToken() {
    setBusy(true);
    try {
      let r = await fetch("/api/kiosk/token", { credentials: "include", headers: { "x-no-loading": "1" } });
      let d = await r.json().catch(() => null);
      let tk = d?.token as string | null;
      if (!tk) { r = await fetch("/api/kiosk/token", { method: "POST", credentials: "include" }); d = await r.json().catch(() => null); tk = d?.token ?? null; }
      setToken(tk);
    } finally { setBusy(false); }
  }
  useEffect(() => { ensureToken(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function rotate() {
    if (!confirm("Gerar links NOVOS para todos os painéis? Os links atuais deixam de funcionar.")) return;
    setBusy(true);
    try { const r = await fetch("/api/kiosk/token", { method: "POST", credentials: "include" }); const d = await r.json().catch(() => null); setToken(d?.token ?? null); } finally { setBusy(false); }
  }

  function urlFor(kind: string) { return token ? `${typeof window !== "undefined" ? window.location.origin : ""}/k/${kind}/${token}` : ""; }
  async function copy(kind: string) {
    const u = urlFor(kind); if (!u) return;
    try { await navigator.clipboard?.writeText(u); setCopied(kind); setTimeout(() => setCopied(null), 1800); } catch {}
  }

  return (
    <div className="mb-8 rounded-2xl border border-line bg-bg/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">📺 Painéis de TV (kiosk)</h2>
          <p className="mt-1 text-sm text-muted">Telas de acompanhamento em tempo real, sem login. Abra o link no navegador de uma TV/computador — atualiza sozinho a cada 30s.</p>
        </div>
        <button onClick={rotate} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-fg disabled:opacity-50">Gerar links novos</button>
      </div>

      <div className="mt-4 space-y-2">
        {busy && !token ? <p className="text-sm text-muted">Gerando link…</p> : panels.map((p) => {
          const u = urlFor(p.kind);
          return (
            <div key={p.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted">{p.desc}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => copy(p.kind)} disabled={!u} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{copied === p.kind ? "Copiado ✅" : "Copiar link"}</button>
                <a href={u || "#"} target="_blank" rel="noreferrer" className={`rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand ${!u ? "pointer-events-none opacity-50" : ""}`}>Abrir ↗</a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
