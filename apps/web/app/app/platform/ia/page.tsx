"use client";

import { useEffect, useState } from "react";

const NICHE_LABEL: Record<string, string> = { otica: "Ótica", grafica: "Gráfica/Uniformes", generico: "Genérico" };

/**
 * Painel master de aprendizado da IA (Fase 1): assertividade agregada, gargalos
 * e ranking por empresa/nicho. Base para o ecossistema de IA proprietário.
 */
const TYPE_LABEL: Record<string, string> = { answered: "Respondidas", uncertain: "Incertas", fallback: "Falhas", handoff: "Transferidas", tool: "Ferramenta", human_teach: "Ensino" };
const PROVIDER_LABEL: Record<string, string> = { groq: "Groq (grátis)", gemini: "Gemini (grátis)", cloudflare: "Cloudflare (grátis)", local: "Ollama (local)", anthropic: "Anthropic", openai: "OpenAI" };

export default function MasterIaPanel() {
  const [data, setData] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [doubts, setDoubts] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [traceFor, setTraceFor] = useState<string | null>(null);
  const [eco, setEco] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const h = { credentials: "include" as const, headers: { "x-no-loading": "1" } };
  function loadQuestions() {
    fetch("/api/insights/master-questions", h).then((r) => (r.ok ? r.json() : null)).then((d) => setQuestions(d?.items ?? [])).catch(() => {});
  }
  useEffect(() => {
    fetch("/api/ai-learning/admin/stats", h).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
    fetch("/api/ai-learning/usage", h).then((r) => (r.ok ? r.json() : null)).then(setUsage).catch(() => {});
    fetch("/api/ai-learning/doubts", h).then((r) => (r.ok ? r.json() : null)).then((d) => setDoubts(d?.items ?? [])).catch(() => {});
    fetch("/api/ai-learning/recent", h).then((r) => (r.ok ? r.json() : null)).then((d) => setRecent(d?.items ?? [])).catch(() => {});
    fetch("/api/insights/ecosystem", h).then((r) => (r.ok ? r.json() : null)).then(setEco).catch(() => {});
    loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answerQuestion(id: string) {
    const answer = (draft[id] ?? "").trim();
    if (!answer) return;
    await fetch(`/api/insights/master-questions/${id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ answer }) });
    setDraft((d) => ({ ...d, [id]: "" }));
    loadQuestions();
  }
  async function dismissQuestion(id: string) {
    await fetch(`/api/insights/master-questions/${id}/dismiss`, { method: "POST", credentials: "include" });
    loadQuestions();
  }

  return (
    <main className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master · IA</p>
        <h1 className="mt-1 text-3xl font-semibold">Aprendizado da IA</h1>
        <p className="mt-2 text-muted">Como a IA do call center está performando entre as empresas. Gargalos, assertividade e ranking.</p>
      </header>

      {/* ===== Inteligência do ecossistema ===== */}
      <section className="mb-8 rounded-2xl border border-brand/30 bg-brand/5 p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Inteligência do ecossistema</h2>
        <p className="mt-1 text-sm text-muted">Gargalos operacionais somados de todas as empresas + dúvidas que a IA levanta pra você ensinar.</p>

        {eco && (
          <div className="mt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card title="Gargalos abertos" value={String(eco.totals?.open ?? 0)} />
              <Card title="Urgentes" value={String(eco.totals?.urgent ?? 0)} highlight />
              <Card title="Empresas com dúvidas" value={String(questions.length)} />
            </div>
            {(eco.totals?.byKind ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {eco.totals.byKind.map((k: any) => (
                  <span key={k.kind} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{k.kind}: <b className="text-fg">{k.count}</b></span>
                ))}
              </div>
            )}
            {(eco.items ?? []).length > 0 && (
              <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
                {eco.items.slice(0, 30).map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs transition hover:border-brand/50">
                    <span><b>{i.orgName}</b>{i.niche ? ` · ${NICHE_LABEL[i.niche] ?? i.niche}` : ""} — {i.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${i.severity === "urgent" ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"}`}>{i.severity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5">
          <h3 className="text-sm font-semibold">Dúvidas da IA pra você ensinar</h3>
          {questions.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Sem dúvidas no momento. Quando padrões aparecerem entre as empresas, a IA pergunta aqui.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {questions.map((q) => (
                <div key={q.id} className="rounded-xl border border-line bg-surface p-3">
                  <p className="text-sm">{q.question}</p>
                  {q.topic && <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">{q.topic}</p>}
                  <textarea
                    value={draft[q.id] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [q.id]: e.target.value }))}
                    placeholder="Ensine a IA: como responder isso melhor?"
                    rows={2}
                    className="input-base mt-2 text-xs"
                  />
                  <div className="mt-1 flex gap-2">
                    <button onClick={() => answerQuestion(q.id)} className="btn-grad px-3 py-1 text-xs">Ensinar</button>
                    <button onClick={() => dismissQuestion(q.id)} className="rounded-lg border border-line px-3 py-1 text-xs text-muted transition hover:text-fg">Dispensar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== Uso das IAs grátis + Aprendizado (RAG) ===== */}
      {usage && (
        <section className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Uso das IAs grátis & aprendizado (RAG)</h2>
          <p className="mt-1 text-sm text-muted">Qual IA respondeu, se os provedores estão conectados/em cooldown, e o quanto a base de conhecimento cresceu. <b>Importante:</b> o modelo não "treina" — quem aprende é a base (RAG), alimentada quando alguém ensina.</p>

          {/* uso por provedor */}
          <h3 className="mt-4 text-sm font-semibold">Quem respondeu (por provedor)</h3>
          {(usage.byProvider ?? []).length === 0 ? (
            <p className="mt-1 text-xs text-muted">Nenhuma resposta registrada ainda — ou a IA do call center ainda não foi usada.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {(() => { const max = Math.max(...usage.byProvider.map((p: any) => p.count), 1); return usage.byProvider.map((p: any) => (
                <div key={p.provider} className="flex items-center gap-2 text-xs">
                  <span className="w-40 shrink-0 truncate">{PROVIDER_LABEL[p.provider] ?? p.provider}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-grad-brand" style={{ width: `${Math.round((p.count / max) * 100)}%` }} /></div>
                  <span className="w-12 shrink-0 text-right font-medium">{p.count}</span>
                </div>
              )); })()}
            </div>
          )}

          {/* saúde dos provedores */}
          {(usage.providers ?? []).length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Provedores configurados (conexão)</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {usage.providers.map((p: any) => {
                  const down = p.active === 0;
                  const cooling = p.inCooldown > 0;
                  return (
                    <div key={p.provider} className={`rounded-xl border px-3 py-2 text-xs ${down ? "border-danger/40 bg-danger/5" : cooling ? "border-warn/40 bg-warn/5" : "border-success/30 bg-success/5"}`} title={p.lastError ? `Último erro: ${p.lastError}` : ""}>
                      <p className="font-medium">{PROVIDER_LABEL[p.provider] ?? p.provider}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{p.active}/{p.configured} ativo(s){cooling ? ` · ${p.inCooldown} em cooldown` : ""}{down ? " · sem chave/desligado" : ""}</p>
                      {p.lastUsedAt && <p className="text-[10px] text-muted">usado {new Date(p.lastUsedAt).toLocaleDateString("pt-BR")}</p>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* RAG / base de conhecimento */}
          <h3 className="mt-5 text-sm font-semibold">O que o ecossistema aprendeu (base RAG)</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-4">
            <Card title="Q&As na base" value={String(usage.rag?.kbPublished ?? 0)} highlight />
            <Card title="Ensinados por humano" value={String(usage.rag?.kbHumanTaught ?? 0)} />
            <Card title="Indexados (embeddings)" value={String(usage.rag?.indexed ?? 0)} />
            <Card title="Buscas semânticas" value={usage.embeddingsEnabled ? "Ligado" : "Desligado"} />
          </div>
          {!usage.embeddingsEnabled && (
            <p className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-warn">⚠️ Embeddings desligados (EMBEDDINGS_URL vazio) — o RAG cai pra busca por texto. Pra busca semântica via Ollama, configure o EMBEDDINGS_URL apontando pro Ollama e rode o backfill.</p>
          )}
          {(usage.rag?.growth ?? []).length > 0 && (
            <p className="mt-2 text-[11px] text-muted">Crescimento (8 sem.): {usage.rag.growth.map((g: any) => `${g.week.slice(5)}=${g.count}`).join(" · ")}</p>
          )}
        </section>
      )}

      {!data ? <p className="text-sm text-muted">Carregando…</p> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <Card title="Assertividade média" value={data.assertiveness != null ? `${data.assertiveness}%` : "—"} highlight />
            <Card title="Interações totais" value={String(data.total ?? 0)} />
            <Card title="Dúvidas abertas" value={String(data.pendingDoubts ?? 0)} />
            <Card title="Transferências" value={String(data.counts?.handoff ?? 0)} />
          </div>

          {(data.perNiche ?? []).length > 0 && (
            <>
              <h2 className="mb-3 text-lg font-semibold">Por nicho</h2>
              <div className="card mb-6 overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left text-[10px] uppercase tracking-wider text-muted">
                    <tr><th className="px-4 py-2">Nicho</th><th className="px-4 py-2">Empresas</th><th className="px-4 py-2">Interações</th><th className="px-4 py-2">Dúvidas</th><th className="px-4 py-2">Assertividade</th></tr>
                  </thead>
                  <tbody>
                    {data.perNiche.map((n: any) => (
                      <tr key={n.niche} className="border-t border-line/60 transition hover:bg-surface-2">
                        <td className="px-4 py-2 font-medium">{NICHE_LABEL[n.niche] ?? n.niche}</td>
                        <td className="px-4 py-2">{n.orgs}</td>
                        <td className="px-4 py-2">{n.total}</td>
                        <td className="px-4 py-2">{n.doubts}</td>
                        <td className="px-4 py-2">{n.assertiveness != null ? `${n.assertiveness}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2 className="mb-3 text-lg font-semibold">Por empresa</h2>
          {(data.perOrg ?? []).length === 0 ? <p className="card p-6 text-sm text-muted">Sem dados ainda.</p> : (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-[10px] uppercase tracking-wider text-muted">
                  <tr><th className="px-4 py-2">Empresa</th><th className="px-4 py-2">Nicho</th><th className="px-4 py-2">Interações</th><th className="px-4 py-2">Dúvidas</th><th className="px-4 py-2">Assertividade</th></tr>
                </thead>
                <tbody>
                  {data.perOrg.map((o: any) => (
                    <tr key={o.organizationId} className="border-t border-line/60 transition hover:bg-surface-2">
                      <td className="px-4 py-2 font-medium">{o.name}</td>
                      <td className="px-4 py-2 text-muted">{NICHE_LABEL[o.niche] ?? o.niche ?? "—"}</td>
                      <td className="px-4 py-2">{o.total}</td>
                      <td className="px-4 py-2">{o.doubts}</td>
                      <td className="px-4 py-2">{o.assertiveness != null ? `${o.assertiveness}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Dúvidas de TODAS as empresas — base pra definir as regras reais da IA */}
          <h2 className="mb-2 mt-8 text-lg font-semibold">Dúvidas da IA (todas as empresas)</h2>
          <p className="mb-3 text-xs text-muted">Onde a IA travou em cada empresa. Use pra entender padrões e definir as regras/guarda-corpos reais. Quem ensina a resposta é o admin de cada empresa.</p>
          {doubts.length === 0 ? <p className="card p-6 text-sm text-muted">Nenhuma dúvida pendente nas empresas. 👏</p> : (
            <div className="space-y-2">
              {doubts.slice(0, 50).map((d) => (
                <div key={d.id} className="card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">{d.organizationName ?? "—"}</span>
                        {d.organizationNiche && <span className="text-[10px] text-muted">{NICHE_LABEL[d.organizationNiche] ?? d.organizationNiche}</span>}
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">{TYPE_LABEL[d.eventType] ?? d.eventType}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{d.question || "(sem texto)"}</p>
                      {d.response && <p className="mt-0.5 text-xs text-muted">IA: {d.response}</p>}
                      <p className="mt-1 text-[10px] text-muted">{new Date(d.createdAt).toLocaleString("pt-BR")}</p>
                    </div>
                    {d.conversationId && <button onClick={() => setTraceFor(d.conversationId)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted transition hover:border-brand">fluxo</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Respostas recentes de todas as empresas com acesso ao fluxo */}
          {recent.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">Respostas recentes da IA (todas)</h2>
              <div className="space-y-2">
                {recent.slice(0, 30).map((r) => (
                  <div key={r.id} className="card flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0 text-sm">
                      <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">{r.organizationName ?? "—"}</span>
                      <p className="mt-1 truncate text-muted">{r.question || "—"}</p>
                      <p className="mt-0.5 truncate">{r.response || "—"}</p>
                    </div>
                    {r.conversationId && <button onClick={() => setTraceFor(r.conversationId)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted transition hover:border-brand">fluxo</button>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {traceFor && <TraceModal conversationId={traceFor} onClose={() => setTraceFor(null)} />}
    </main>
  );
}

const STEP_META: Record<string, { label: string; icon: string }> = {
  tool: { label: "Ferramenta", icon: "🔧" }, answered: { label: "Respondeu", icon: "💬" },
  uncertain: { label: "Incerta", icon: "🤔" }, fallback: { label: "Falhou", icon: "⚠️" },
  handoff: { label: "Transferiu", icon: "➡️" }, human_teach: { label: "Ensino", icon: "🎓" },
};

function TraceModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [steps, setSteps] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`/api/ai-learning/trace/${conversationId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setSteps(d?.steps ?? [])).catch(() => setSteps([]));
  }, [conversationId]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Fluxo da IA nesta conversa</h3>
        <p className="mt-1 text-xs text-muted">Passo a passo: o que a IA consultou, quais ações fez e o que respondeu.</p>
        {steps === null ? <p className="mt-4 text-sm text-muted">Carregando…</p>
          : steps.length === 0 ? <p className="mt-4 rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">Sem passos registrados.</p>
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
                        {s.provider && <span className="rounded-full border border-line bg-surface-2 px-1.5 text-[9px] text-muted">{s.provider}{s.model ? ` · ${s.model}` : ""}</span>}
                      </div>
                      {s.question && <p className="mt-0.5 break-words text-sm font-medium">{s.question}</p>}
                      {s.response && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted">{s.response}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-brand hover:text-fg">fechar</button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 ${highlight ? "border-brand/40 bg-brand/10" : "border-line bg-surface hover:border-brand/50"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{title}</p>
      <p className={`mt-1 text-2xl font-semibold ${highlight ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}
