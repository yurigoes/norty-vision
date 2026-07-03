"use client";

import { useCallback, useEffect, useState } from "react";

interface Grant { id: string; duration: string; grantedAt: string; expiresAt: string | null; revokedAt: string | null }

const DUR_LABEL: Record<string, string> = { "24h": "24 horas", "30d": "30 dias", "90d": "90 dias", "sempre": "Sem expiração" };

export function OrgSupportAccessCard({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<Grant[]>([]);
  const [duration, setDuration] = useState("30d");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/platform/orgs/${orgId}/support-access`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function grant() {
    setBusy(true); setKey(null);
    try {
      const res = await fetch(`/api/platform/orgs/${orgId}/support-access`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ duration }) });
      const d = await res.json(); if (res.ok) { setKey(d.key); load(); }
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    await fetch(`/api/platform/support-access/${id}`, { method: "DELETE", credentials: "include" }); load();
  }

  const now = Date.now();
  return (
    <section className="rounded-xl border border-line bg-bg/60 p-6">
      <h2 className="text-lg font-semibold">Acesso de suporte (token)</h2>
      <p className="text-sm text-muted">Libera o acesso do <strong>suporte master</strong> a esta empresa por um período. O dono do SaaS tem acesso total. A empresa também pode revogar.</p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Duração</span>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            <option value="24h">24 horas</option><option value="30d">30 dias</option><option value="90d">90 dias</option><option value="sempre">Sem expiração</option>
          </select>
        </label>
        <button onClick={grant} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Liberar acesso</button>
      </div>
      {key && (
        <div className="mt-3 rounded-lg border border-green-500/40 bg-green-500/10 p-3">
          <p className="text-xs font-semibold text-green-100">Chave de acesso (anote — mostrada só agora):</p>
          <p className="mt-1 break-all font-mono text-sm">{key}</p>
        </div>
      )}
      <div className="mt-4 space-y-1">
        {items.map((g) => {
          const active = !g.revokedAt && (!g.expiresAt || new Date(g.expiresAt).getTime() > now);
          return (
            <div key={g.id} className="flex items-center justify-between rounded border border-line/60 px-3 py-2 text-sm">
              <span>{DUR_LABEL[g.duration] ?? g.duration} · {active ? <span className="text-green-300">ativo</span> : <span className="text-muted">{g.revokedAt ? "revogado" : "expirado"}</span>}{g.expiresAt ? ` · até ${new Date(g.expiresAt).toLocaleString("pt-BR")}` : ""}</span>
              {active && <button onClick={() => revoke(g.id)} className="text-xs text-muted hover:text-red-300">revogar</button>}
            </div>
          );
        })}
        {items.length === 0 && <p className="text-xs text-muted">Nenhum acesso de suporte liberado.</p>}
      </div>
    </section>
  );
}
