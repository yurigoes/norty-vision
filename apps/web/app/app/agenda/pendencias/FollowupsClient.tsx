"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Followup {
  id: string;
  kind: string;
  note: string | null;
  status: string;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null; whatsappPhone: string | null };
}

const KIND_LABEL: Record<string, string> = {
  appointment_canceled: "Cancelou exame",
  reschedule_requested: "Pediu reagendamento",
  other: "Outro",
};

export function FollowupsClient({ items }: { items: Followup[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function resolve(id: string, status: "done" | "dismissed") {
    setBusy(id);
    try {
      const res = await fetch(`/api/schedule/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (res.ok) startTransition(() => router.refresh());
    } finally { setBusy(null); }
  }

  async function notifyNext(id: string) {
    setBusy(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    try {
      const res = await fetch(`/api/schedule/followups/${id}/notify-next`, { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) { setMsg((m) => ({ ...m, [id]: `Erro: ${d?.error?.message ?? "falha"}` })); return; }
      const date = d.date ? new Date(d.date).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "";
      setMsg((m) => ({ ...m, [id]: d.ok ? `✓ Enviado (próxima data: ${date})` : "Não foi possível enviar (sem WhatsApp/email?)" }));
    } catch {
      setMsg((m) => ({ ...m, [id]: "Erro de conexão" }));
    } finally { setBusy(null); }
  }

  if (items.length === 0) {
    return <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Nenhuma pendência. 🎉</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((f) => {
        return (
          <div key={f.id} className="rounded-xl border border-line bg-bg/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{f.customer.name}</p>
                <p className="text-xs text-muted">
                  {f.customer.phone ?? "sem telefone"} · {new Date(f.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                {KIND_LABEL[f.kind] ?? f.kind}
              </span>
            </div>
            {f.note && <p className="mt-2 text-sm text-muted">{f.note}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button disabled={busy === f.id} onClick={() => notifyNext(f.id)} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                {busy === f.id ? "Enviando..." : "Enviar próxima data por WhatsApp"}
              </button>
              <button disabled={busy === f.id} onClick={() => resolve(f.id, "done")} className="rounded-lg border border-green-500/40 px-3 py-1 text-xs text-green-300 hover:bg-green-500/10 disabled:opacity-50">
                Remarcado / resolvido
              </button>
              <button disabled={busy === f.id} onClick={() => resolve(f.id, "dismissed")} className="rounded-lg border border-line px-3 py-1 text-xs text-muted hover:text-red-300 disabled:opacity-50">
                Descartar
              </button>
              {msg[f.id] && <span className="text-xs text-muted">{msg[f.id]}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
