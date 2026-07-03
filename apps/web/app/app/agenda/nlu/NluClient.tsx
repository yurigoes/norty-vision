"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface UnresolvedItem {
  id: string;
  rawText: string;
  candidates: Array<{ intent: string; score: number }>;
  status: string;
  createdAt: string;
}

interface Keyword {
  id: string;
  organizationId: string | null;
  storeId: string | null;
  intent: string;
  keyword: string;
  matchType: string;
  weight: number;
  isActive: boolean;
  source: string;
}

const INTENTS = ["confirm", "reschedule", "cancel", "question", "opt_out", "unknown"];

const INTENT_COLORS: Record<string, string> = {
  confirm: "bg-green-500/20 text-green-300",
  reschedule: "bg-orange-500/20 text-orange-300",
  cancel: "bg-red-500/20 text-red-300",
  question: "bg-blue-500/20 text-blue-300",
  opt_out: "bg-yellow-500/20 text-yellow-300",
  unknown: "bg-line text-muted",
};

export function NluClient({
  initialUnresolved,
  initialKeywords,
}: {
  initialUnresolved: UnresolvedItem[];
  initialKeywords: Keyword[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"unresolved" | "keywords" | "test">("unresolved");

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-line">
        <TabBtn active={tab === "unresolved"} onClick={() => setTab("unresolved")}>
          Fila ({initialUnresolved.length})
        </TabBtn>
        <TabBtn active={tab === "keywords"} onClick={() => setTab("keywords")}>
          Palavras-chave ({initialKeywords.length})
        </TabBtn>
        <TabBtn active={tab === "test"} onClick={() => setTab("test")}>
          Testar
        </TabBtn>
      </nav>

      {tab === "unresolved" && (
        <UnresolvedList
          items={initialUnresolved}
          onChange={() => startTransition(() => router.refresh())}
        />
      )}
      {tab === "keywords" && (
        <KeywordsList
          items={initialKeywords}
          onChange={() => startTransition(() => router.refresh())}
        />
      )}
      {tab === "test" && <ClassifyTester />}
    </div>
  );
}

function UnresolvedList({
  items,
  onChange,
}: {
  items: UnresolvedItem[];
  onChange: () => void;
}) {
  if (items.length === 0) {
    return (
      <p className="card p-6 text-sm text-muted">
        Nenhuma resposta pendente de revisão. Quando o sistema receber uma
        mensagem ambígua, ela aparece aqui.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <UnresolvedCard key={it.id} item={it} onChange={onChange} />
      ))}
    </div>
  );
}

function UnresolvedCard({
  item,
  onChange,
}: {
  item: UnresolvedItem;
  onChange: () => void;
}) {
  const [resolving, setResolving] = useState(false);

  async function resolve(intent: string, promote: boolean) {
    setResolving(true);
    const res = await fetch(`/api/nlu/unresolved/${item.id}/resolve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolvedIntent: intent,
        promoteAsKeyword: promote,
      }),
      credentials: "include",
    });
    setResolving(false);
    if (res.ok) onChange();
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">
            {new Date(item.createdAt).toLocaleString("pt-BR")}
          </p>
          <blockquote className="mt-2 border-l-2 border-brand pl-3 text-base">
            {item.rawText}
          </blockquote>
          {item.candidates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.candidates.map((c, i) => (
                <span
                  key={i}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    INTENT_COLORS[c.intent]
                  }`}
                >
                  {c.intent} {(c.score * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {INTENTS.map((intent) => (
          <div key={intent} className="flex">
            <button
              onClick={() => resolve(intent, false)}
              disabled={resolving}
              className={`rounded-l-md border border-line px-3 py-1.5 text-xs ${
                INTENT_COLORS[intent]
              } hover:opacity-80 disabled:opacity-50`}
            >
              {intent}
            </button>
            {intent !== "unknown" && (
              <button
                onClick={() => resolve(intent, true)}
                disabled={resolving}
                title="Resolver E promover como palavra-chave nova"
                className="rounded-r-md border border-l-0 border-line bg-bg/60 px-2 py-1.5 text-xs hover:bg-bg disabled:opacity-50"
              >
                + kw
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeywordsList({
  items,
  onChange,
}: {
  items: Keyword[];
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const grouped: Record<string, Keyword[]> = {};
  for (const k of items) {
    grouped[k.intent] = grouped[k.intent] ?? [];
    grouped[k.intent].push(k);
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => setCreating(true)}
        className="btn-grad"
      >
        + Nova palavra-chave
      </button>

      {creating && <CreateKeywordForm onClose={() => { setCreating(false); onChange(); }} />}

      {INTENTS.filter((i) => i !== "unknown").map((intent) => (
        <div key={intent}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            {intent} ({grouped[intent]?.length ?? 0})
          </h3>
          <div className="flex flex-wrap gap-1">
            {(grouped[intent] ?? []).map((kw) => (
              <span
                key={kw.id}
                title={`weight ${kw.weight} · ${kw.matchType} · ${kw.source}`}
                className={`rounded-md px-2 py-1 text-xs ${
                  kw.organizationId
                    ? "border border-brand/40"
                    : "border border-line"
                }`}
              >
                <span className="font-mono">{kw.keyword}</span>
                {kw.organizationId === null && (
                  <span className="ml-1 text-[10px] text-muted">global</span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateKeywordForm({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/nlu/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: String(fd.get("intent")),
        keyword: String(fd.get("keyword")),
        matchType: String(fd.get("matchType")),
        weight: Number(fd.get("weight")),
      }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha");
      return;
    }
    onClose();
  }

  return (
    <form
      onSubmit={submit}
      className="card space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Intent
          </span>
          <select
            name="intent"
            className="input-base"
          >
            {INTENTS.filter((i) => i !== "unknown").map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Palavra/frase
          </span>
          <input
            name="keyword"
            required
            placeholder="confirma"
            className="input-base"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Tipo
          </span>
          <select
            name="matchType"
            defaultValue="contains"
            className="input-base"
          >
            <option value="exact">exact</option>
            <option value="contains">contains</option>
            <option value="starts_with">starts_with</option>
            <option value="regex">regex</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Peso (0-1)
          </span>
          <input
            name="weight"
            type="number"
            min={0}
            max={1}
            step={0.05}
            defaultValue="0.9"
            className="input-base"
          />
        </label>
      </div>
      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:bg-surface-2"
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn-grad"
        >
          Adicionar
        </button>
      </div>
    </form>
  );
}

function ClassifyTester() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function test() {
    setLoading(true);
    const res = await fetch("/api/nlu/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      credentials: "include",
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Cole uma resposta de WhatsApp pra testar como o sistema classificaria.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Ex: pode confirmar, vou sim"
        className="input-base"
      />
      <button
        onClick={test}
        disabled={loading || !text.trim()}
        className="btn-grad"
      >
        {loading ? "Classificando..." : "Classificar"}
      </button>
      {result && (
        <div className="card">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                INTENT_COLORS[result.intent]
              }`}
            >
              {result.intent}
            </span>
            <span className="text-sm text-muted">
              confiança {(result.score * 100).toFixed(0)}% · via{" "}
              {result.classifiedBy}
            </span>
          </div>
          {result.candidates && result.candidates.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              <p className="text-muted">Candidatos:</p>
              {result.candidates.map((c: any, i: number) => (
                <div key={i} className="flex justify-between font-mono">
                  <span>{c.intent}</span>
                  <span>{(c.score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-brand text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
