"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

const CAT_LABEL: Record<string, string> = { duvida: "Dúvida", bug: "Problema/bug", solicitacao: "Solicitação", senha: "Trocar senha", email: "Trocar e-mail", telefone: "Trocar telefone", outro: "Outro" };
const STATUS_LABEL: Record<string, string> = { aberto: "Aberto", aguardando_master: "Com você", aguardando_usuario: "Aguardando usuário", resolvido_ia: "Resolvido pela IA", resolvido: "Resolvido", fechado: "Fechado" };
const STATUS_CLS: Record<string, string> = { aberto: "bg-sky-500/15 text-sky-300", aguardando_master: "bg-amber-500/15 text-amber-300", aguardando_usuario: "bg-purple-500/15 text-purple-300", resolvido_ia: "bg-green-500/15 text-green-300", resolvido: "bg-green-500/15 text-green-300", fechado: "bg-line text-muted" };
const FILTERS = [["", "Todos"], ["aguardando_master", "Com você"], ["aguardando_usuario", "Aguardando usuário"], ["resolvido", "Resolvidos"]] as const;

export function MasterSuporteClient() {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = () => fetch(`/api/platform-support/master/tickets${filter ? `?status=${filter}` : ""}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => <button key={v} onClick={() => setFilter(v)} className={`rounded-full px-3 py-1 text-xs ${filter === v ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{l}</button>)}
      </div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">Nenhum chamado.</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4 text-left hover:border-brand">
              <div><p className="font-medium">{t.subject} <span className="ml-1 text-xs text-muted">{t.shortCode}</span></p>
                <p className="text-xs text-muted">{CAT_LABEL[t.category] ?? t.category}{t.requesterName ? ` · ${t.requesterName}` : ""}{t.requesterRole ? ` (${t.requesterRole})` : ""} · {new Date(t.updatedAt).toLocaleString("pt-BR")}</p></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_CLS[t.status] ?? "bg-line text-muted"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
            </button>
          ))}
        </div>
      )}
      {openId && <MasterThread id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function MasterThread({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [t, setT] = useState<any | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`/api/platform-support/master/tickets/${id}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setT(d?.ticket ?? null)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function send(resolve: boolean) {
    if (reply.trim().length < 1) { dialog.toast("Escreva a resposta", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/platform-support/master/tickets/${id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ body: reply.trim(), internal, resolve }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      setReply(""); setInternal(false); setT(d?.ticket ?? t); onChanged();
      dialog.toast(resolve ? "Respondido e resolvido ✅" : internal ? "Nota interna salva" : "Resposta enviada ✅", "success");
    } finally { setBusy(false); }
  }
  if (!t) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-base font-semibold">{t.subject} <span className="text-xs text-muted">{t.shortCode}</span></h3>
            <p className="text-xs text-muted">{CAT_LABEL[t.category] ?? t.category}{t.requesterName ? ` · ${t.requesterName}` : ""} · <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS[t.status] ?? ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span></p></div>
          <button onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-lg border border-line/60 bg-bg/40 p-3">
          {(t.messages ?? []).map((m: any) => (
            <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.author === "master" ? "ml-auto bg-purple-500/15" : m.author === "usuario" ? "bg-brand/15" : m.author === "sistema" ? "bg-line/40 text-muted" : "bg-bg/70 border border-line"} ${m.internal ? "border border-dashed border-amber-400/50" : ""}`}>
              <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted">{m.author === "usuario" ? "Usuário" : m.author === "ia" ? "IA" : m.author === "master" ? "Você" : "Sistema"}{m.internal ? " · nota interna" : ""} · {new Date(m.createdAt).toLocaleString("pt-BR")}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Responder ao usuário…" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4" /> Nota interna (usuário não vê)</label>
            <div className="ml-auto flex gap-2">
              <button disabled={busy} onClick={() => send(false)} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand disabled:opacity-50">Responder</button>
              <button disabled={busy || internal} onClick={() => send(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Responder e resolver</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
