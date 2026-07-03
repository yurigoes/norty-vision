"use client";

import { useState } from "react";

const ITEMS = [
  { key: "chatwoot", title: "Chatwoot →", desc: "Abrir o atendimento já logado (mesma sessão)." },
  { key: "glpi", title: "GLPI →", desc: "Abrir o helpdesk/ativos da sua conta." },
] as const;

export function SsoCards() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function open(key: string) {
    setBusy(key); setErr(null);
    // abre a aba ANTES do await (evita bloqueio de popup) e depois aponta a URL
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/sso/${key}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error?.message ?? "Falha no SSO");
      if (tab) tab.location.href = data.url;
      else window.location.href = data.url;
    } catch (e: any) {
      if (tab) tab.close();
      setErr(e.message);
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {err && <p className="sm:col-span-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
      {ITEMS.map((it) => (
        <button
          key={it.key}
          onClick={() => open(it.key)}
          disabled={busy === it.key}
          className="card block text-left disabled:opacity-50"
        >
          <h3 className="text-base font-semibold">{busy === it.key ? "Abrindo..." : it.title}</h3>
          <p className="mt-1 text-sm text-muted">{it.desc}</p>
        </button>
      ))}
    </div>
  );
}
