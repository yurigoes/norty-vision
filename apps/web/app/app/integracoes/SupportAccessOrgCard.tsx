"use client";

import { useCallback, useEffect, useState } from "react";

interface Grant { id: string; duration: string; grantedAt: string; expiresAt: string | null; revokedAt: string | null; active: boolean }

const DUR_LABEL: Record<string, string> = { "24h": "24 horas", "30d": "30 dias", "90d": "90 dias", "sempre": "sem expiração" };

export function SupportAccessOrgCard() {
  const [items, setItems] = useState<Grant[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/support-access/mine", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revoke(id: string) {
    await fetch(`/api/support-access/${id}/revoke`, { method: "POST", credentials: "include" });
    load();
  }

  const active = items.filter((g) => g.active);
  if (!loaded) return null;

  return (
    <section className="card mt-6 p-6">
      <h2 className="text-lg font-semibold">Acesso do suporte</h2>
      <p className="mt-1 text-sm text-muted">
        Quando você pede ajuda, a equipe de suporte recebe acesso temporário ao seu painel.
        Você pode revogar esse acesso a qualquer momento.
      </p>
      {active.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-bg/40 p-4 text-sm text-muted">
          Nenhum acesso de suporte ativo no momento. ✅
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {active.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
              <span>
                Acesso ativo ({DUR_LABEL[g.duration] ?? g.duration})
                {g.expiresAt ? ` · até ${new Date(g.expiresAt).toLocaleString("pt-BR")}` : ""}
              </span>
              <button onClick={() => revoke(g.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-red-400 hover:text-red-300">
                Revogar acesso
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
