"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useDialog } from "../../../../components/SystemDialog";

type Topic = { topic: string; count: number; samples: string[] };

function todayMinus(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }

export default function MaioresDuvidas() {
  const dialog = useDialog();
  const [from, setFrom] = useState(todayMinus(30));
  const [to, setTo] = useState(todayMinus(0));
  const [data, setData] = useState<{ total: number; topics: Topic[] } | null>(null);
  const [draft, setDraft] = useState<{ topic: string; shortcut: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/inbox/top-questions?from=${from}&to=${to}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...(data?.topics.map((t) => t.count) ?? [1]));

  async function suggest(t: Topic) {
    setBusy(true);
    setDraft({ topic: t.topic, shortcut: t.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20), body: "" });
    try {
      const res = await fetch("/api/inbox/suggest-answer", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ topic: t.topic, samples: t.samples }) });
      const d = await res.json().catch(() => null);
      setDraft((cur) => cur ? { ...cur, body: d?.suggestion ?? "" } : cur);
      if (!d?.suggestion) dialog.toast("IA não configurada — escreva a resposta manualmente.", "info");
    } finally { setBusy(false); }
  }
  function startManual(t: Topic) {
    setDraft({ topic: t.topic, shortcut: t.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20), body: "" });
  }
  async function saveCanned() {
    if (!draft || !draft.shortcut.trim() || !draft.body.trim()) { dialog.toast("Preencha atalho e texto", "error"); return; }
    const res = await fetch("/api/inbox/canned", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ shortcut: draft.shortcut.trim(), title: draft.topic, body: draft.body.trim(), scope: "global" }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Não foi possível salvar (precisa ser admin)", "error"); return; }
    dialog.toast("Resposta rápida criada ✅", "success");
    setDraft(null);
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
          <h1 className="mt-1 text-3xl font-semibold">Maiores dúvidas</h1>
          <p className="mt-2 text-muted">O que os clientes mais perguntam — vai aprendendo com o volume de conversas.</p>
        </div>
        <div className="flex items-end gap-2 text-sm">
          <label className="block"><span className="block text-[10px] uppercase text-muted">De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base mt-1 w-auto" /></label>
          <label className="block"><span className="block text-[10px] uppercase text-muted">Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base mt-1 w-auto" /></label>
        </div>
      </header>

      <p className="card mb-4 text-sm">Perguntas classificadas no período: <strong>{data?.total ?? 0}</strong></p>

      <div className="space-y-3">
        {(data?.topics.length ?? 0) === 0 ? (
          <p className="card p-8 text-center text-sm text-muted">Sem dados ainda. Conforme as conversas chegam, os temas aparecem aqui.</p>
        ) : data!.topics.map((t) => (
          <div key={t.topic} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-fg">{t.topic}</span>
              <span className="text-sm text-muted">{t.count}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${(t.count / max) * 100}%` }} /></div>
            {t.samples.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {t.samples.map((s, i) => <li key={i} className="truncate">“{s}”</li>)}
              </ul>
            )}
            <div className="mt-2 flex gap-2 text-xs">
              <button onClick={() => suggest(t)} disabled={busy} className="rounded-lg border border-brand/50 px-3 py-1 text-brand transition hover:bg-brand/10 disabled:opacity-50">✨ Sugerir resposta (IA)</button>
              <button onClick={() => startManual(t)} className="rounded-lg border border-line px-3 py-1 transition hover:border-brand hover:text-brand">criar resposta</button>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Resposta rápida — {draft.topic}</h3>
            <p className="mt-1 text-xs text-muted">Vira uma resposta global pra equipe usar no atendimento.</p>
            <label className="mt-3 block text-[10px] uppercase text-muted">Atalho</label>
            <input value={draft.shortcut} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} className="input-base mt-1" />
            <label className="mt-2 block text-[10px] uppercase text-muted">Texto {busy && "· gerando com IA…"}</label>
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} className="input-base mt-1" />
            <div className="mt-3 flex gap-2">
              <button onClick={saveCanned} className="btn-grad flex-1 py-2">Salvar resposta</button>
              <button onClick={() => setDraft(null)} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
