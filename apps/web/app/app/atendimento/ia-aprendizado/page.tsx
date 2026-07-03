"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

const TYPE_LABEL: Record<string, string> = {
  answered: "Respondidas", uncertain: "Incertas", fallback: "Falhas", handoff: "Transferidas", tool: "Ferramentas", human_teach: "Ensinos",
};

/**
 * Aprendizado de IA (Fase 1) — painel da empresa: assertividade, gargalos e as
 * "dúvidas da IA" pra você ensinar. O que você ensina vira resposta da base de
 * conhecimento, que o bot já usa nas próximas conversas.
 */
export default function IaAprendizado() {
  const dialog = useDialog();
  const [stats, setStats] = useState<any>(null);
  const [doubts, setDoubts] = useState<any[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [teachFor, setTeachFor] = useState<any | null>(null);
  const [emb, setEmb] = useState<{ enabled: boolean; model: string } | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [traceFor, setTraceFor] = useState<string | null>(null);

  const load = () => {
    fetch("/api/ai-learning/stats", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => {});
    fetch("/api/ai-learning/doubts", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setDoubts(d?.items ?? [])).catch(() => setDoubts([]));
    fetch("/api/ai-learning/recent", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setRecent(d?.items ?? [])).catch(() => {});
    fetch("/api/ai-learning/embeddings/status", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setEmb).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function backfill() {
    setIndexing(true);
    try {
      const res = await fetch("/api/ai-learning/embeddings/backfill", { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      if (d?.enabled) dialog.toast(`Base indexada ✅ — ${d.indexed} entrada(s) com memória semântica`, "success");
      else dialog.toast("Memória semântica desligada (configure EMBEDDINGS_URL no servidor)", "error");
      load();
    } finally { setIndexing(false); }
  }

  async function dismiss(id: string) {
    await fetch(`/api/ai-learning/${id}/dismiss`, { method: "POST", credentials: "include" });
    load();
  }
  async function rate(id: string, helpful: boolean) {
    await fetch(`/api/ai-learning/${id}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ helpful }) });
    load();
  }

  return (
    <main className="max-w-3xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Atendimento · IA</p>
        <h1 className="mt-1 text-3xl font-semibold">Aprendizado da IA</h1>
        <p className="mt-2 text-muted">Como a IA está se saindo no atendimento e onde ela travou. Ensine as dúvidas para ela acertar mais.</p>
      </header>

      {emb && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${emb.enabled ? "bg-green-400" : "bg-muted"}`} />
              <span className="text-sm font-medium">Memória semântica {emb.enabled ? "ativa" : "desligada"}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {emb.enabled
                ? `A IA busca respostas por significado (modelo ${emb.model}), não só por palavras iguais. Indexe a base para ativar nas respostas existentes.`
                : "Hoje a busca é por palavras (full-text). Para ativar a busca por significado, configure o serviço de embeddings no servidor."}
            </p>
          </div>
          {emb.enabled && (
            <button onClick={backfill} disabled={indexing} className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {indexing ? "Indexando…" : "Indexar base (IA)"}
            </button>
          )}
        </div>
      )}

      {stats && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <Card title="Assertividade" value={stats.assertiveness != null ? `${stats.assertiveness}%` : "—"} highlight />
          <Card title="Úteis (👍)" value={stats.helpfulRate != null ? `${stats.helpfulRate}%` : "—"} />
          <Card title="Dúvidas abertas" value={String(stats.pendingDoubts ?? 0)} />
          <Card title="Interações" value={String(stats.total ?? 0)} />
        </div>
      )}

      {stats?.trend?.length > 0 && <Trend title="Assertividade por semana" data={stats.trend} />}

      {stats?.byModule?.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {stats.byModule.map((m: any) => (
            <span key={m.module} className="rounded-full border border-line bg-bg/40 px-2.5 py-1 text-[11px]">{m.module}: <b>{m.count}</b></span>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Dúvidas para ensinar</h2>
      {doubts === null ? <p className="text-sm text-muted">Carregando…</p>
        : doubts.length === 0 ? <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Nenhuma dúvida pendente. A IA está dando conta 👏</p>
        : (
          <div className="space-y-2">
            {doubts.map((d) => (
              <div key={d.id} className="rounded-xl border border-line bg-bg/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">{TYPE_LABEL[d.eventType] ?? d.eventType}</span>
                    <p className="mt-1 text-sm font-medium">{d.question || "(sem texto)"}</p>
                    {d.response && <p className="mt-1 text-xs text-muted">IA: {d.response}</p>}
                    <p className="mt-1 text-[10px] text-muted">{new Date(d.createdAt).toLocaleString("pt-BR")}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setTeachFor(d)} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white">Ensinar</button>
                    <button onClick={() => dismiss(d.id)} className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:border-brand">Dispensar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Respostas recentes da IA</h2>
          <p className="mb-3 text-xs text-muted">Avalie pra ensinar o que funciona (alimenta o score).</p>
          <div className="space-y-2">
            {recent.slice(0, 15).map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-bg/60 p-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate text-muted">{r.question || "—"}</p>
                  <p className="mt-0.5 truncate">{r.response || "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.conversationId && <button onClick={() => setTraceFor(r.conversationId)} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-brand" title="Ver passo a passo da IA">fluxo</button>}
                  <button onClick={() => rate(r.id, true)} className={`rounded-md border px-2 py-1 text-xs ${r.helpful === true ? "border-green-400 bg-green-500/15 text-green-300" : "border-line text-muted hover:border-green-400"}`}>👍</button>
                  <button onClick={() => rate(r.id, false)} className={`rounded-md border px-2 py-1 text-xs ${r.helpful === false ? "border-red-400 bg-red-500/15 text-red-300" : "border-line text-muted hover:border-red-400"}`}>👎</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {teachFor && <TeachModal event={teachFor} onClose={() => setTeachFor(null)} onSaved={() => { setTeachFor(null); load(); dialog.toast("IA ensinada ✅ — virou resposta da base", "success"); }} />}
      {traceFor && <TraceModal conversationId={traceFor} onClose={() => setTraceFor(null)} />}
    </main>
  );
}

// rótulo + ícone por tipo de passo do fluxo da IA
const STEP_META: Record<string, { label: string; icon: string }> = {
  tool: { label: "Ferramenta", icon: "🔧" },
  answered: { label: "Respondeu", icon: "💬" },
  uncertain: { label: "Incerta", icon: "🤔" },
  fallback: { label: "Falhou", icon: "⚠️" },
  handoff: { label: "Transferiu", icon: "➡️" },
  human_teach: { label: "Ensino", icon: "🎓" },
};

function TraceModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [steps, setSteps] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`/api/ai-learning/trace/${conversationId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setSteps(d?.steps ?? [])).catch(() => setSteps([]));
  }, [conversationId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Fluxo da IA nesta conversa</h3>
        <p className="mt-1 text-xs text-muted">Passo a passo: o que a IA consultou, quais ações fez e o que respondeu. Use para auditar em caso de erro.</p>
        {steps === null ? <p className="mt-4 text-sm text-muted">Carregando…</p>
          : steps.length === 0 ? <p className="mt-4 rounded-lg border border-line bg-bg/60 p-4 text-sm text-muted">Sem passos registrados para esta conversa.</p>
          : (
            <ol className="mt-4 space-y-0">
              {steps.map((s, i) => {
                const meta = STEP_META[s.eventType] ?? { label: s.eventType, icon: "•" };
                return (
                  <li key={s.id} className="relative flex gap-3 pb-4 pl-1">
                    <div className="flex flex-col items-center">
                      <span className="text-base leading-none">{meta.icon}</span>
                      {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-brand">{meta.label}</span>
                        <span className="text-[10px] text-muted">{new Date(s.createdAt).toLocaleString("pt-BR")}</span>
                        {s.provider && <span className="rounded-full border border-line px-1.5 text-[9px] text-muted">{s.provider}{s.model ? ` · ${s.model}` : ""}</span>}
                      </div>
                      {s.question && <p className="mt-0.5 text-sm font-medium break-words">{s.question}</p>}
                      {s.response && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted">{s.response}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">fechar</button>
        </div>
      </div>
    </div>
  );
}

function Trend({ title, data }: { title: string; data: Array<{ week: string; assertiveness: number | null }> }) {
  return (
    <div className="mb-6 rounded-xl border border-line bg-bg/60 p-4">
      <p className="mb-3 text-[10px] uppercase tracking-wider text-muted">{title}</p>
      <div className="flex items-end gap-1.5" style={{ height: 80 }}>
        {data.map((d) => (
          <div key={d.week} className="flex flex-1 flex-col items-center gap-1" title={`${d.week}: ${d.assertiveness ?? "—"}%`}>
            <div className="w-full rounded-t bg-brand/70" style={{ height: `${Math.max(4, (d.assertiveness ?? 0) * 0.7)}px` }} />
            <span className="text-[8px] text-muted">{d.week.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-brand/40 bg-brand/10" : "border-line bg-bg/60"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{title}</p>
      <p className={`mt-1 text-2xl font-semibold ${highlight ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}

function TeachModal({ event, onClose, onSaved }: { event: any; onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [question, setQuestion] = useState(event.question ?? "");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);

  async function draft() {
    setDrafting(true);
    try {
      const res = await fetch(`/api/ai-learning/${event.id}/draft`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      if (d?.suggestion) setAnswer(d.suggestion);
      else dialog.toast("A IA não conseguiu sugerir agora", "error");
    } finally { setDrafting(false); }
  }

  async function save() {
    if (!question.trim() || !answer.trim()) { dialog.toast("Preencha pergunta e resposta", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-learning/${event.id}/teach`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ question: question.trim(), answer: answer.trim() }) });
      if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Ensinar a IA</h3>
        <p className="mt-1 text-xs text-muted">Vira uma resposta publicada na base de conhecimento; o bot usa nas próximas conversas.</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Pergunta / situação</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase text-muted">Resposta correta</span>
            <button type="button" onClick={draft} disabled={drafting} className="text-xs font-medium text-brand hover:underline disabled:opacity-50">{drafting ? "Gerando…" : "✨ Sugerir resposta (IA)"}</button>
          </div>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} placeholder="O que a IA deveria responder…" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
          <button disabled={busy} onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Ensinar"}</button>
        </div>
      </div>
    </div>
  );
}
