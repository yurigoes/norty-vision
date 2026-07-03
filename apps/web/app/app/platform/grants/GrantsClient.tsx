"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

type Member = { id: string; name: string; email: string; role: string; status: string; techSpecsCategories?: string[] };

export function GrantsClient() {
  const dialog = useDialog();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/platform/team", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setMembers(d?.items ?? [])).catch(() => setMembers([]));
    fetch("/api/platform/specs/categories", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setCats(d?.items ?? [])).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function save(m: Member, categories: string[]) {
    setBusy(m.id);
    try {
      const r = await fetch(`/api/platform/team/${m.id}/specs`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ categories }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      setMembers((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, techSpecsCategories: categories } : x)));
      dialog.toast("Acesso atualizado ✅", "success");
    } finally { setBusy(null); }
  }

  if (members === null) return <p className="text-sm text-muted">Carregando…</p>;
  const support = members.filter((m) => m.role !== "owner");

  return (
    <div className="space-y-4">
      {cats.length === 0 && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">Nenhuma categoria de Specs Técnicas publicada ainda. Cadastre specs (com categoria) para liberar aqui.</p>}
      {members.filter((m) => m.role === "owner").map((m) => (
        <div key={m.id} className="card p-4">
          <p className="font-medium">{m.name} <span className="ml-1 text-xs text-muted">{m.email}</span> <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">owner</span></p>
          <p className="mt-1 text-xs text-muted">Owner vê todas as categorias (acesso total).</p>
        </div>
      ))}
      {support.length === 0 ? (
        <p className="card p-6 text-center text-muted">Nenhum membro de suporte. Crie em <a href="/app/platform/team" className="text-brand hover:underline">Equipe</a>.</p>
      ) : support.map((m) => {
        const granted = new Set(m.techSpecsCategories ?? []);
        const all = granted.has("*");
        return (
          <div key={m.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{m.name} <span className="ml-1 text-xs text-muted">{m.email}</span> <span className="ml-1 rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">{m.role}</span></p>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={all} disabled={busy === m.id} onChange={(e) => save(m, e.target.checked ? ["*"] : [])} className="h-4 w-4" />
                Todas as categorias
              </label>
            </div>
            {!all && (
              <div className="mt-2 flex flex-wrap gap-2">
                {cats.map((c) => {
                  const on = granted.has(c);
                  return (
                    <button key={c} disabled={busy === m.id} onClick={() => { const next = new Set(granted); on ? next.delete(c) : next.add(c); save(m, [...next]); }}
                      className={`rounded-full px-3 py-1 text-xs ${on ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{c}</button>
                  );
                })}
                {cats.length > 0 && granted.size === 0 && <span className="self-center text-[11px] text-muted">Sem acesso a nenhuma categoria.</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
