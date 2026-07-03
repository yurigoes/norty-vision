"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
}

const TARGETS: Array<{ key: string; label: string; path: string; hint: string }> = [
  { key: "painel", label: "Painel", path: "/app", hint: "Visão geral da empresa" },
  { key: "agenda", label: "Agenda", path: "/app/agenda", hint: "Consultas e pendências" },
  { key: "leads", label: "Leads", path: "/app/leads", hint: "Funil de leads" },
  { key: "pdv", label: "PDV", path: "/app/vendas", hint: "Frente de caixa / vendas" },
  { key: "caixa", label: "Caixa", path: "/app/caixa", hint: "Turnos e fechamento" },
];

/**
 * Atalho global do master: escolhe uma empresa e entra direto num módulo
 * (impersonação registrada). Pra suporte rápido sem navegar até a empresa.
 */
export function MasterViewCompany() {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("painel");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || orgs) return;
    fetch("/api/organizations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrgs((d?.items ?? []) as Org[]))
      .catch(() => setOrgs([]));
  }, [open, orgs]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = orgs ?? [];
    if (!term) return list.slice(0, 50);
    return list
      .filter((o) => o.name.toLowerCase().includes(term) || o.slug.toLowerCase().includes(term))
      .slice(0, 50);
  }, [orgs, q]);

  async function enter(org: Org) {
    setBusyId(org.id);
    setError(null);
    try {
      const res = await fetch(`/api/platform/impersonate/${org.id}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao entrar na empresa");
      const path = TARGETS.find((t) => t.key === target)?.path ?? "/app";
      window.location.href = path;
    } catch (e: any) {
      setError(e.message);
      setBusyId(null);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg/80 transition hover:bg-line/40 hover:text-fg"
      >
        👁 Visualizar empresa
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[8vh] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-line bg-bg/90 p-6 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold">Visualizar empresa</h3>
              <p className="mt-1 text-sm text-muted">
                Entre no painel de uma empresa para suporte rápido. Tudo fica registrado.
              </p>

              <div className="mt-4">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Abrir em</span>
                <div className="flex flex-wrap gap-2">
                  {TARGETS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTarget(t.key)}
                      title={t.hint}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        target === t.key ? "border-transparent bg-brand text-white" : "border-line text-muted hover:text-fg"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar empresa por nome ou slug..."
                className="mt-4 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
              />

              {error && (
                <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
              )}

              <div className="mt-3 max-h-[40vh] space-y-1 overflow-auto">
                {orgs === null ? (
                  <p className="py-6 text-center text-sm text-muted">Carregando...</p>
                ) : shown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">Nenhuma empresa encontrada.</p>
                ) : (
                  shown.map((o) => (
                    <button
                      key={o.id}
                      disabled={busyId !== null}
                      onClick={() => enter(o)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-bg/60 px-4 py-2.5 text-left transition hover:border-brand disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{o.name}</span>
                        <span className="block truncate text-[11px] text-muted">/{o.slug}{o.status !== "active" ? ` · ${o.status}` : ""}</span>
                      </span>
                      <span className="shrink-0 text-xs text-brand">{busyId === o.id ? "entrando..." : "entrar →"}</span>
                    </button>
                  ))
                )}
              </div>

              <button onClick={() => setOpen(false)} className="mt-4 w-full text-center text-xs text-muted hover:text-fg">
                fechar
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
