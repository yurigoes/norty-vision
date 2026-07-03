"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useDialog } from "../../../../components/SystemDialog";

type Kb = { id: string; topic: string | null; question: string; answer: string; status: string; aiGenerated: boolean; usageCount: number };

export default function PainelAjuda() {
  const dialog = useDialog();
  const [items, setItems] = useState<Kb[]>([]);
  const [editing, setEditing] = useState<Partial<Kb> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/kb", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setItems(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing?.question?.trim() || !editing?.answer?.trim()) { dialog.toast("Preencha pergunta e resposta", "error"); return; }
    setBusy(true);
    const res = await fetch("/api/kb", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: editing.id, question: editing.question, answer: editing.answer, topic: editing.topic, status: editing.status ?? "draft", aiGenerated: editing.aiGenerated }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Não foi possível salvar", "error"); return; }
    setEditing(null); load();
  }
  async function aiDraft() {
    if (!editing?.question?.trim()) { dialog.toast("Escreva a pergunta primeiro", "error"); return; }
    setBusy(true);
    const res = await fetch("/api/kb/draft", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ question: editing.question }) });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (d?.suggestion) setEditing((e) => e ? { ...e, answer: d.suggestion, aiGenerated: true } : e);
    else dialog.toast("IA não configurada — escreva a resposta manualmente.", "info");
  }
  async function setStatus(k: Kb, status: string) {
    await fetch(`/api/kb/${k.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    load();
  }
  async function remove(k: Kb) {
    if (!(await dialog.confirm({ title: "Arquivar", message: `Arquivar "${k.question}"?`, tone: "danger" }))) return;
    await fetch(`/api/kb/${k.id}/delete`, { method: "POST", credentials: "include" });
    load();
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
          <h1 className="mt-1 text-2xl font-semibold">Central de ajuda</h1>
          <p className="text-sm text-muted">Perguntas + respostas que a equipe usa e que o cliente vê no portal. Publique pra aparecer no portal do cliente.</p>
        </div>
        <button onClick={() => setEditing({ status: "draft" })} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Pergunta</button>
      </header>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Nenhuma pergunta cadastrada. Crie a partir das "Maiores dúvidas" ou aqui.</p>
        ) : items.map((k) => (
          <div key={k.id} className="rounded-xl border border-line bg-bg/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{k.question} {k.aiGenerated && <span className="text-[10px] text-brand">✨ IA</span>}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{k.answer}</p>
                <p className="mt-1 text-[10px] text-muted">{k.topic ? `${k.topic} · ` : ""}usada {k.usageCount}×</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${k.status === "published" ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}>{k.status === "published" ? "publicada" : "rascunho"}</span>
                <div className="flex gap-2">
                  {k.status === "published" ? <button onClick={() => setStatus(k, "draft")} className="text-muted hover:text-fg">despublicar</button> : <button onClick={() => setStatus(k, "published")} className="text-green-300 hover:underline">publicar</button>}
                  <button onClick={() => setEditing(k)} className="text-brand hover:underline">editar</button>
                  <button onClick={() => remove(k)} className="text-red-300 hover:underline">arquivar</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{editing.id ? "Editar pergunta" : "Nova pergunta"}</h3>
            <label className="mt-3 block text-[10px] uppercase text-muted">Pergunta</label>
            <input value={editing.question ?? ""} onChange={(e) => setEditing({ ...editing, question: e.target.value })} placeholder="Ex.: Qual o horário de funcionamento?" className="mt-1 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            <div className="mt-2 flex items-center justify-between">
              <label className="text-[10px] uppercase text-muted">Resposta</label>
              <button onClick={aiDraft} disabled={busy} className="text-xs text-brand hover:underline disabled:opacity-50">✨ rascunhar com IA</button>
            </div>
            <textarea value={editing.answer ?? ""} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} rows={5} placeholder="Resposta padrão…" className="mt-1 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            <input value={editing.topic ?? ""} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} placeholder="Tema (opcional)" className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            <label className="mt-2 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={editing.status === "published"} onChange={(e) => setEditing({ ...editing, status: e.target.checked ? "published" : "draft" })} /> publicar no portal do cliente
            </label>
            <div className="mt-4 flex gap-2">
              <button disabled={busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar</button>
              <button onClick={() => setEditing(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
