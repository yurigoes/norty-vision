"use client";

import { useState } from "react";

interface Contact {
  id: string; name: string; email: string; phone: string | null; company: string | null;
  segment: string | null; message: string | null; status: string; notes: string | null; createdAt: string;
}

const STATUS = [
  { key: "new", label: "Novo", cls: "bg-blue-500/20 text-blue-300" },
  { key: "contacted", label: "Em contato", cls: "bg-orange-500/20 text-orange-300" },
  { key: "won", label: "Ganho", cls: "bg-green-500/20 text-green-300" },
  { key: "lost", label: "Perdido", cls: "bg-red-500/20 text-red-300" },
];

export function ContatosClient({ initial }: { initial: Contact[] }) {
  const [items, setItems] = useState<Contact[]>(initial);
  const [filter, setFilter] = useState<string>("");

  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/platform/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    if (res.ok) setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
  }

  const shown = filter ? items.filter((i) => i.status === filter) : items;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("")} className={`rounded-full border px-3 py-1 text-xs ${filter === "" ? "border-brand bg-brand/15 text-fg" : "border-line text-muted"}`}>Todos</button>
        {STATUS.map((s) => (
          <button key={s.key} onClick={() => setFilter(s.key)} className={`rounded-full border px-3 py-1 text-xs ${filter === s.key ? "border-brand bg-brand/15 text-fg" : "border-line text-muted"}`}>{s.label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum lead.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((c) => {
            const st = STATUS.find((s) => s.key === c.status) ?? STATUS[0]!;
            return (
              <div key={c.id} className="rounded-xl border border-line bg-bg/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name} <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${st.cls}`}>{st.label}</span></p>
                    <p className="text-xs text-muted">
                      {c.email}{c.phone ? ` · ${c.phone}` : ""}{c.company ? ` · ${c.company}` : ""}{c.segment ? ` · ${c.segment}` : ""} · {new Date(c.createdAt).toLocaleString("pt-BR")}
                    </p>
                    {c.message && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{c.message}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex gap-2">
                      <a href={`mailto:${c.email}`} className="text-xs text-brand hover:underline">email</a>
                      {c.phone && <a href={`https://wa.me/55${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">whats</a>}
                    </div>
                    <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-xs">
                      {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
