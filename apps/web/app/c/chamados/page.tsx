"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Ticket = {
  id: string; code: string; subject: string; status: string; priority: string;
  createdAt: string; resolvedAt: string | null; closedAt: string | null;
};
type Msg = { id: string; authorType: string; authorName: string | null; body: string; createdAt: string };
type Detail = Ticket & { description?: string; messages: Msg[]; serviceOrders?: any[] };

const STATUS: Record<string, string> = {
  new: "Aberto", triage: "Em triagem", open: "Em atendimento", pending: "Pendente",
  waiting_customer: "Aguardando você", resolved: "Resolvido", closed: "Fechado", reopened: "Reaberto",
};
const STATUS_CLS: Record<string, string> = {
  resolved: "text-green-300", closed: "text-muted", reopened: "text-orange-300",
};

export default function PortalChamados() {
  const router = useRouter();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    fetch("/api/portal/tickets", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => d && setList(d.items ?? []))
      .catch(() => {});
  }, [router]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/c" className="text-sm text-brand hover:underline">← Voltar</Link>
          <h1 className="mt-1 text-2xl font-semibold">Meus chamados</h1>
        </div>
        <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          Abrir chamado
        </button>
      </header>

      {list === null ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">
          Você ainda não abriu nenhum chamado. Clique em “Abrir chamado” pra falar com a loja.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4 text-left transition hover:border-brand">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.subject}</p>
                <p className="text-xs text-muted">{t.code} · {new Date(t.createdAt).toLocaleDateString("pt-BR")}</p>
              </div>
              <span className={`shrink-0 text-xs font-semibold ${STATUS_CLS[t.status] ?? "text-brand"}`}>{STATUS[t.status] ?? t.status}</span>
            </button>
          ))}
        </div>
      )}

      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
      {openId && <TicketDetail id={openId} onClose={() => { setOpenId(null); reload(); }} />}
    </main>
  );
}

function NewTicket({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/portal/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ subject, description, priority }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao abrir"); return; }
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Abrir chamado</h3>
        {err && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto"
          className="mt-3 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm outline-none focus:border-brand" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o que você precisa" rows={4}
          className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm outline-none focus:border-brand" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}
          className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm outline-none focus:border-brand">
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
        <div className="mt-4 flex gap-2">
          <button disabled={busy || !subject.trim() || !description.trim()} onClick={submit}
            className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Enviando…" : "Abrir chamado"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [t, setT] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/portal/tickets/${id}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setT(d))
      .catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // tempo real: enquanto aberto, atualiza a cada 8s (sem piscar o loading)
  useEffect(() => {
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/tickets/${id}/reply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ body: reply }),
      });
      if (res.ok) { setReply(""); load(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {!t ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{t.subject}</h3>
                <p className="text-xs text-muted">{t.code} · {STATUS[t.status] ?? t.status}</p>
              </div>
              <button onClick={onClose} className="text-xs text-muted hover:text-fg">fechar</button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-line bg-bg/40 p-3">
              {t.messages.map((m) => {
                const mine = m.authorType === "customer";
                return (
                  <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? "ml-auto bg-brand/15" : "bg-line/60"}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {mine ? "Você" : (m.authorName || "Atendente")} · {new Date(m.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                );
              })}
            </div>

            {t.status === "resolved" ? (
              <ConfirmClose id={id} onDone={() => { load(); }} />
            ) : t.status !== "closed" ? (
              <div className="mt-3 flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escreva uma resposta…"
                  onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
                  className="flex-1 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm outline-none focus:border-brand" />
                <button disabled={busy || !reply.trim()} onClick={sendReply}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Enviar</button>
              </div>
            ) : (
              <p className="mt-3 text-center text-xs text-muted">Chamado fechado.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmClose({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(satisfied: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/portal/tickets/${id}/confirm-close`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ satisfied, rating: satisfied ? rating || undefined : undefined, comment: comment || undefined }),
      });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-lg border border-green-500/40 bg-green-500/5 p-3">
      <p className="text-sm font-medium text-green-300">A loja marcou seu chamado como resolvido.</p>
      <p className="mt-1 text-xs text-muted">Confirme o fechamento e avalie o atendimento, ou reabra se ainda não resolveu.</p>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className={`text-xl ${n <= rating ? "text-amber-400" : "text-line"}`}>★</button>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Observação (opcional)" rows={2}
        className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs outline-none focus:border-brand" />
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={() => act(true)} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
          Confirmar e avaliar
        </button>
        <button disabled={busy} onClick={() => act(false)} className="rounded-lg border border-orange-500/50 px-3 py-2 text-sm text-orange-300 hover:bg-orange-500/10">
          Reabrir
        </button>
      </div>
    </div>
  );
}
