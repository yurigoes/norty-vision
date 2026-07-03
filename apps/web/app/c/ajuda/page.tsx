"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Kb = { id: string; topic: string | null; question: string; answer: string };

export default function PortalAjuda() {
  const router = useRouter();
  const [list, setList] = useState<Kb[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/portal/help", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => d && setList(d.items ?? []))
      .catch(() => {});
  }, [router]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <Link href="/c" className="text-sm text-brand hover:underline">← Voltar</Link>
        <h1 className="mt-1 text-2xl font-semibold">Central de ajuda</h1>
        <p className="text-sm text-muted">Perguntas frequentes.</p>
      </header>

      {list === null ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Sem perguntas publicadas no momento.</p>
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div key={k.id} className="rounded-xl border border-line bg-bg/60">
              <button onClick={() => setOpen(open === k.id ? null : k.id)} className="flex w-full items-center justify-between gap-2 p-4 text-left">
                <span className="font-medium">{k.question}</span>
                <span className="text-muted">{open === k.id ? "−" : "+"}</span>
              </button>
              {open === k.id && <p className="whitespace-pre-wrap border-t border-line/60 p-4 text-sm text-muted">{k.answer}</p>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
