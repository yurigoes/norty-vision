"use client";

import { useCallback, useEffect, useState } from "react";
import { MODULE_GROUPS } from "../../../../../lib/modules";

interface Grant {
  id: string;
  moduleKey: string;
  kind: "trial" | "alacarte" | "courtesy";
  priceCents: number | null;
  expiresAt: string | null;
  blocked: boolean;
  paid: boolean;
  notes: string | null;
}

function brl(c: number | null | undefined): string {
  return ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const KIND_LABEL: Record<string, string> = { trial: "Experimental", alacarte: "À la carte", courtesy: "Cortesia" };

export function OrgModulesCard({ orgId }: { orgId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [planModules, setPlanModules] = useState<string[]>([]);
  const [planName, setPlanName] = useState<string | null>(null);
  // módulo em edição (abrindo o painelzinho de liberar)
  const [editKey, setEditKey] = useState<string | null>(null);
  const [kind, setKind] = useState<"courtesy" | "trial" | "alacarte">("courtesy");
  const [days, setDays] = useState("7");
  const [priceReais, setPriceReais] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/platform/orgs/${orgId}/module-grants`, { credentials: "include", cache: "no-store" });
    const d = await res.json();
    if (res.ok) {
      setGrants(d.items ?? []);
      setPlanModules(Array.isArray(d.planModules) ? d.planModules : []);
      setPlanName(d.planName ?? null);
    }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const grantOf = (key: string) => grants.find((g) => g.moduleKey === key);
  const isActive = (g?: Grant) => !!g && !g.blocked && (g.paid || g.expiresAt == null || new Date(g.expiresAt) > new Date());
  // plano sem features = não restringe nada (empresa vê todos os módulos)
  const planUnrestricted = planModules.length === 0;

  function openEditor(key: string) {
    setEditKey(key); setKind("courtesy"); setDays("7"); setPriceReais(""); setNotes(""); setMsg(null);
  }

  async function liberar(moduleKey: string) {
    setBusy(true); setMsg(null);
    try {
      const payload: any = { moduleKey, kind, notes: notes || null };
      if (kind === "trial") payload.days = Number(days) || 7;
      if (kind === "alacarte") payload.priceCents = priceReais ? Math.round(Number(priceReais.replace(",", ".")) * 100) : 0;
      const res = await fetch(`/api/platform/orgs/${orgId}/module-grants`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      setEditKey(null); load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function revoke(key: string) {
    await fetch(`/api/platform/orgs/${orgId}/module-grants/${key}`, { method: "DELETE", credentials: "include" });
    load();
  }
  async function markPaid(key: string) {
    await fetch(`/api/platform/orgs/${orgId}/module-grants/${key}/mark-paid`, { method: "POST", credentials: "include" });
    load();
  }
  async function block(key: string) {
    await fetch(`/api/platform/orgs/${orgId}/module-grants/${key}/block`, { method: "POST", credentials: "include" });
    load();
  }
  async function unblock(key: string) {
    await fetch(`/api/platform/orgs/${orgId}/module-grants/${key}/unblock`, { method: "POST", credentials: "include" });
    load();
  }

  return (
    <section className="card p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Módulos da empresa</h2>
        {planName && <span className="rounded-full bg-line px-2 py-0.5 text-[11px] text-muted">Plano: {planName}</span>}
      </div>
      <p className="mb-4 text-sm text-muted">
        Os módulos do plano vêm liberados automaticamente. Os que o plano <b>não cobre</b> aparecem bloqueados (🔒) — libere por cortesia, experimental ou à la carte (cobrança).
        Pra <b>esconder</b> um módulo do plano só desta empresa, use <b>bloquear</b> (override).
      </p>

      {planUnrestricted && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Este plano não restringe módulos — a empresa enxerga <b>todos</b>. Defina os módulos do plano em <b>Planos</b> para poder bloquear/cobrar individualmente.
        </div>
      )}

      <div className="space-y-5">
        {MODULE_GROUPS.map((group) => (
          <div key={group.group}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{group.group}</h3>
            <div className="space-y-1.5">
              {group.modules.map((m) => {
                const inPlan = planUnrestricted || planModules.includes(m.key);
                const g = grantOf(m.key);
                const active = isActive(g);
                const expired = g?.expiresAt && new Date(g.expiresAt) < new Date() && !g.paid;
                // Override do master: módulo do plano explicitamente bloqueado pra essa empresa.
                const blockedOverride = !!g?.blocked;
                return (
                  <div key={m.key} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{m.label}</span>
                      <div className="flex items-center gap-2">
                        {inPlan && blockedOverride ? (
                          <>
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">🚫 bloqueado (override)</span>
                            <button onClick={() => unblock(m.key)} className="text-[11px] text-green-300 hover:underline">desbloquear</button>
                          </>
                        ) : inPlan ? (
                          <>
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">no plano</span>
                            <button onClick={() => block(m.key)} className="text-[11px] text-muted hover:text-red-300" title="Esconder este módulo só pra esta empresa, mesmo estando no plano">bloquear</button>
                          </>
                        ) : active ? (
                          <>
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300">{KIND_LABEL[g!.kind]}</span>
                            <span className="text-[11px] text-muted">
                              {g!.priceCents ? `${brl(g!.priceCents)} · ` : ""}
                              {g!.expiresAt ? `vence ${new Date(g!.expiresAt).toLocaleDateString("pt-BR")}` : "sem expiração"}
                              {g!.paid ? " · pago" : ""}
                            </span>
                            {g!.kind === "alacarte" && !g!.paid && <button onClick={() => markPaid(m.key)} className="text-[11px] text-green-300 hover:underline">marcar pago</button>}
                            <button onClick={() => revoke(m.key)} className="text-[11px] text-muted hover:text-red-300">revogar</button>
                          </>
                        ) : (
                          <>
                            <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">🔒 {expired ? "venceu" : "bloqueado"}</span>
                            <button onClick={() => openEditor(m.key)} className="rounded-md border border-line px-2 py-1 text-[11px] hover:border-brand">liberar</button>
                          </>
                        )}
                      </div>
                    </div>

                    {editKey === m.key && (
                      <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-line pt-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] uppercase text-muted">Modalidade</span>
                          <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="input-base w-auto px-2 py-1.5">
                            <option value="courtesy">Cortesia (grátis)</option>
                            <option value="trial">Experimental (X dias)</option>
                            <option value="alacarte">À la carte (cobrança)</option>
                          </select>
                        </label>
                        {kind === "trial" && (
                          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Dias</span>
                            <input type="number" value={days} onChange={(e) => setDays(e.target.value)} className="input-base w-20 px-2 py-1.5" />
                          </label>
                        )}
                        {kind === "alacarte" && (
                          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Preço (R$)</span>
                            <input value={priceReais} onChange={(e) => setPriceReais(e.target.value)} inputMode="decimal" className="input-base w-28 px-2 py-1.5" />
                          </label>
                        )}
                        <label className="block flex-1 min-w-[160px]"><span className="mb-1 block text-[10px] uppercase text-muted">Observação</span>
                          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opcional" className="input-base px-2 py-1.5" />
                        </label>
                        <button onClick={() => liberar(m.key)} disabled={busy} className="btn-grad px-4 py-1.5">{busy ? "..." : "Confirmar"}</button>
                        <button onClick={() => setEditKey(null)} className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted transition hover:text-fg">cancelar</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {msg && <p className="mt-3 text-xs text-red-300">{msg}</p>}
    </section>
  );
}
