"use client";

import { useActionState } from "react";
import { unlockRunbook, type UnlockState } from "./actions";
import type { Block, Section } from "./content";

const initial: UnlockState = { ok: false };

export function RunbookGate() {
  const [state, formAction, pending] = useActionState(unlockRunbook, initial);

  if (state.ok && state.content) {
    return <Runbook sections={state.content} />;
  }

  return (
    <div className="card mx-auto max-w-md p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-lg">🔒</span>
        <h2 className="text-base font-semibold">Conteúdo protegido</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Este runbook é restrito ao master. Digite a senha para liberar.
      </p>
      <form action={formAction} className="space-y-3">
        <input
          type="password"
          name="password"
          autoFocus
          placeholder="Senha do runbook"
          className="input-base"
        />
        {state.error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="btn-grad w-full"
        >
          {pending ? "Verificando…" : "Liberar"}
        </button>
      </form>
    </div>
  );
}

function Runbook({ sections }: { sections: Section[] }) {
  return (
    <div className="space-y-6">
      <nav className="card">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">Índice</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-brand hover:underline">{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="card scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">{s.title}</h2>
          <div className="space-y-3">
            {s.blocks.map((b, i) => (
              <BlockView key={i} block={b} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "p":
      return <p className="text-sm text-fg/90">{block.text}</p>;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg/40 p-3 font-mono text-xs text-fg">
          {block.text}
        </pre>
      );
    case "ol":
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-fg/90">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      );
    case "ul":
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg/90">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "note":
      return (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {block.text}
        </p>
      );
    default:
      return null;
  }
}
