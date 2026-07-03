"use client";

import { useEffect, useState } from "react";
import { MODULE_GROUPS } from "../../../../lib/modules";

/**
 * Master define o preço à la carte de cada módulo (mensal). Deixa a venda
 * avulsa autônoma: o valor aparece na página do módulo bloqueado da empresa.
 */
export default function MasterModulePricing() {
  const [prices, setPrices] = useState<Record<string, { priceReais: string; active: boolean }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    fetch("/api/module-pricing", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const map: Record<string, { priceReais: string; active: boolean }> = {};
        for (const p of d?.items ?? []) map[p.moduleKey] = { priceReais: (p.priceCents / 100).toFixed(2).replace(".", ","), active: p.active };
        setPrices(map);
      })
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  function setField(key: string, patch: Partial<{ priceReais: string; active: boolean }>) {
    setPrices((p) => ({ ...p, [key]: { priceReais: p[key]?.priceReais ?? "", active: p[key]?.active ?? true, ...patch } }));
  }

  async function save(key: string) {
    setSavingKey(key); setMsg(null);
    try {
      const raw = prices[key]?.priceReais ?? "0";
      const cents = Math.round(Number(raw.replace(/\./g, "").replace(",", ".")) * 100) || 0;
      const res = await fetch(`/api/module-pricing/${key}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ priceCents: cents, active: prices[key]?.active ?? true }),
      });
      if (res.ok) setMsg(`Preço de ${key} salvo.`);
      else setMsg("Falha ao salvar.");
    } finally { setSavingKey(null); }
  }

  return (
    <main className="max-w-3xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master</p>
        <h1 className="mt-1 text-3xl font-semibold">Preços à la carte dos módulos</h1>
        <p className="mt-2 text-muted">Valor mensal de cada módulo vendido avulso. Aparece na página do módulo bloqueado da empresa.</p>
      </header>
      {msg && <p className="mb-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">{msg}</p>}

      <div className="space-y-6">
        {MODULE_GROUPS.map((g) => (
          <section key={g.group}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{g.group}</h2>
            <div className="space-y-2">
              {g.modules.map((m) => {
                const cur = prices[m.key] ?? { priceReais: "", active: true };
                return (
                  <div key={m.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/60 p-3">
                    <span className="min-w-[180px] flex-1 text-sm font-medium">{m.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted">R$</span>
                      <input
                        value={cur.priceReais}
                        onChange={(e) => setField(m.key, { priceReais: e.target.value })}
                        placeholder="0,00"
                        className="w-28 rounded border border-line bg-bg/40 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-muted">/mês</span>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input type="checkbox" checked={cur.active} onChange={(e) => setField(m.key, { active: e.target.checked })} /> ativo
                    </label>
                    <button onClick={() => save(m.key)} disabled={savingKey === m.key} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                      {savingKey === m.key ? "..." : "Salvar"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
