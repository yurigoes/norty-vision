"use client";

import { useCallback, useEffect, useState } from "react";
import { MODULE_SUBMODULES, moduleLabel, submoduleEnabled } from "../../../../../lib/modules";

/**
 * Card do master pra ligar/desligar SUB-MÓDULOS de QUALQUER módulo por empresa
 * (Produção, Atendimento, Financeiro, CRM…). Default-on: a empresa vê tudo; o
 * master só desmarca o que ela não usa. Persiste em
 * call_center_settings.submodule_features via PUT
 * /api/platform/orgs/:id/submodule-features (só as chaves "<modulo>.<sub>"
 * desligadas).
 */
const MODULE_ORDER = ["producao", "atendimento", "financeiro", "crm"];

export function ModuleFeaturesCard({ orgId }: { orgId: string }) {
  // overrides como vieram do back (só chaves desligadas têm `false`)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/platform/orgs/${orgId}/submodule-features`, { credentials: "include", cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setOverrides(d.submoduleFeatures ?? {});
    setLoaded(true);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  function toggle(moduleKey: string, subKey: string) {
    setMsg(null);
    const fk = `${moduleKey}.${subKey}`;
    setOverrides((prev) => {
      const on = submoduleEnabled(prev, moduleKey, subKey);
      const next = { ...prev };
      if (on) next[fk] = false; // desliga
      else delete next[fk];     // volta ao default (ligado)
      return next;
    });
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      // envia o mapa COMPLETO (true/false) de todos os sub-módulos do catálogo
      const features: Record<string, boolean> = {};
      for (const moduleKey of MODULE_ORDER) {
        for (const m of MODULE_SUBMODULES[moduleKey] ?? []) features[`${moduleKey}.${m.key}`] = submoduleEnabled(overrides, moduleKey, m.key);
      }
      const res = await fetch(`/api/platform/orgs/${orgId}/submodule-features`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ features }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha ao salvar");
      setOverrides(d.submoduleFeatures ?? {});
      setMsg("Salvo ✓");
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  const hiddenCount = Object.values(overrides).filter((v) => v === false).length;

  return (
    <section className="card p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Sub-módulos por módulo</h2>
        {hiddenCount > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">{hiddenCount} escondido{hiddenCount > 1 ? "s" : ""}</span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Escolha quais abas/telas dentro de cada módulo essa empresa enxerga. O item principal de cada módulo é sempre visível.
        Tudo vem ligado por padrão — desmarque o que ela não usa.
      </p>

      {!loaded ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <div className="space-y-5">
          {MODULE_ORDER.map((moduleKey) => {
            const subs = MODULE_SUBMODULES[moduleKey] ?? [];
            if (!subs.length) return null;
            return (
              <div key={moduleKey}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{moduleLabel(moduleKey)}</h3>
                <div className="space-y-1.5">
                  {subs.map((m) => {
                    const on = submoduleEnabled(overrides, moduleKey, m.key);
                    return (
                      <label key={m.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 transition hover:border-brand/50">
                        <input type="checkbox" checked={on} onChange={() => toggle(moduleKey, m.key)} className="h-4 w-4 accent-brand" />
                        <span className="flex-1">
                          <span className="text-sm font-medium">{m.label}</span>
                          {m.hint && <span className="block text-[11px] text-muted">{m.hint}</span>}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${on ? "bg-green-500/15 text-green-300" : "bg-line text-muted"}`}>
                          {on ? "visível" : "escondido"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={busy || !loaded} className="btn-grad px-4 py-2">{busy ? "Salvando…" : "Salvar"}</button>
        {msg && <span className={`text-xs ${msg.includes("✓") ? "text-green-300" : "text-red-300"}`}>{msg}</span>}
      </div>
    </section>
  );
}
