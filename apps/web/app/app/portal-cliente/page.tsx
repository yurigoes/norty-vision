"use client";

import { useEffect, useState } from "react";

const FEATURES: Array<{ key: string; label: string; desc: string }> = [
  { key: "crediario", label: "Crediário", desc: "Pedir limite, ver parcelas e pagar." },
  { key: "os", label: "Ordens de serviço", desc: "Acompanhar pedidos de lente / OS (ótica)." },
  { key: "pedidos", label: "Meus pedidos (produção)", desc: "Pedidos de produção, aprovação de arte." },
  { key: "chamados", label: "Chamados / suporte", desc: "Abrir e acompanhar chamados." },
  { key: "contratos", label: "Contratos", desc: "Ver e assinar contratos." },
];

/**
 * Admin configura quais recursos aparecem no portal do cliente da empresa.
 * 'Meus dados', 'Ajuda' e avaliação (NPS) são sempre exibidos.
 */
export default function PortalClienteConfig() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/organizations/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const cfg = d?.organization?.portalConfig;
        const map: Record<string, boolean> = {};
        for (const f of FEATURES) map[f.key] = Array.isArray(cfg) ? cfg.includes(f.key) : true;
        setEnabled(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const features = FEATURES.filter((f) => enabled[f.key]).map((f) => f.key);
      const res = await fetch("/api/organizations/me/portal", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ features }),
      });
      setMsg(res.ok ? "Configuração salva." : "Falha ao salvar.");
    } finally { setBusy(false); }
  }

  return (
    <main className="max-w-2xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Configuração · Portal</p>
        <h1 className="mt-1 text-3xl font-semibold">Portal do cliente</h1>
        <p className="mt-2 text-muted">Escolha quais recursos seus clientes veem no portal. "Meus dados", "Ajuda" e avaliação ficam sempre visíveis.</p>
      </header>
      {!loaded ? <p className="text-sm text-muted">Carregando…</p> : (
        <div className="space-y-2">
          {FEATURES.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-brand/50">
              <input
                type="checkbox"
                checked={!!enabled[f.key]}
                onChange={(e) => setEnabled((m) => ({ ...m, [f.key]: e.target.checked }))}
                className="mt-1 accent-brand"
              />
              <span>
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-xs text-muted">{f.desc}</span>
              </span>
            </label>
          ))}
          {msg && <p className="text-sm text-success">{msg}</p>}
          <button onClick={save} disabled={busy} className="btn-grad mt-2 px-5 py-2.5">
            {busy ? "Salvando…" : "Salvar configuração"}
          </button>
        </div>
      )}
    </main>
  );
}
