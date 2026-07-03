"use client";

import { useEffect, useState } from "react";

const BUTTONS: Array<{ key: string; label: string; desc: string }> = [
  { key: "vender", label: "Vender", desc: "Vender pelo chat (PDV no atendimento)." },
  { key: "agenda", label: "Agenda", desc: "Agendar/confirmar/cancelar sem sair do atendimento." },
];

/**
 * Admin escolhe botão-a-botão quais ações aparecem no Atendimento. Por padrão
 * segue os módulos habilitados; ao salvar, passa a valer exatamente o que ficou
 * marcado aqui.
 */
export default function CallcenterButtonsConfig() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/organizations/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const org = d?.organization ?? d;
        const cfg = org?.callcenterConfig;
        const mods: string[] | null = Array.isArray(org?.enabledModules) ? org.enabledModules : null;
        const map: Record<string, boolean> = {};
        for (const b of BUTTONS) {
          if (Array.isArray(cfg)) map[b.key] = cfg.includes(b.key);
          else map[b.key] = b.key === "vender" ? (mods === null || mods.includes("vendas")) : (mods === null || mods.includes("agenda"));
        }
        setEnabled(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const buttons = BUTTONS.filter((b) => enabled[b.key]).map((b) => b.key);
      const res = await fetch("/api/organizations/me/callcenter", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ buttons }),
      });
      setMsg(res.ok ? "Configuração salva." : "Falha ao salvar.");
    } finally { setBusy(false); }
  }

  return (
    <main className="max-w-2xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
        <h1 className="mt-1 text-3xl font-semibold">Botões do Atendimento</h1>
        <p className="mt-2 text-muted">Escolha quais ações aparecem no atendimento desta empresa. Útil por nicho (ex.: loja esportiva sem "Agenda").</p>
      </header>
      {!loaded ? <p className="text-sm text-muted">Carregando…</p> : (
        <div className="space-y-3">
          {BUTTONS.map((b) => (
            <label key={b.key} className="card flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={!!enabled[b.key]} onChange={(e) => setEnabled((m) => ({ ...m, [b.key]: e.target.checked }))} className="mt-1 accent-brand" />
              <span>
                <span className="block text-sm font-medium text-fg">{b.label}</span>
                <span className="block text-xs text-muted">{b.desc}</span>
              </span>
            </label>
          ))}
          {msg && <p className="text-sm text-success">{msg}</p>}
          <button onClick={save} disabled={busy} className="btn-grad mt-2 px-6 py-2.5 disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      )}
    </main>
  );
}
