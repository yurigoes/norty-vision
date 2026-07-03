"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type SO = {
  id: string; code: string; title: string; equipment: string | null; type: string;
  urgency: string; status: string; totalCents: string | number; openedAt: string;
  readyAt: string | null; deliveredAt: string | null; dueAt: string | null; rating: number | null;
};

const STATUS: Record<string, string> = {
  open: "Recebida", in_progress: "Em execução", waiting_part: "Aguardando peça", ready: "Pronta para retirada", delivered: "Entregue", canceled: "Cancelada",
};
const STATUS_CLS: Record<string, string> = {
  open: "text-fg", in_progress: "text-blue-400", waiting_part: "text-amber-400",
  ready: "text-green-400", delivered: "text-green-400", canceled: "text-red-400",
};
const STEPS = ["open", "in_progress", "ready", "delivered"];

function brl(c: number | string) { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function PortalOS() {
  const router = useRouter();
  const [list, setList] = useState<SO[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/portal/service-orders", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => d && setList(d.items ?? []))
      .catch(() => {});
  }, [router]);
  useEffect(() => { reload(); }, [reload]);
  // tempo real: atualiza a cada 15s
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Link href="/c" className="text-sm text-brand hover:underline">← Voltar</Link>
        <h1 className="mt-1 text-2xl font-semibold">Minhas ordens de serviço</h1>
        <p className="text-sm text-muted">Acompanhe o status do seu conserto/garantia em tempo real.</p>
      </header>

      {list === null ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Nenhuma ordem de serviço.</p>
      ) : (
        <div className="space-y-3">
          {list.map((so) => {
            const stepIdx = STEPS.indexOf(so.status);
            return (
              <div key={so.id} className="rounded-xl border border-line bg-bg/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-muted">{so.code}</p>
                    <p className="font-medium">{so.title}</p>
                    <p className="text-xs text-muted">{[so.equipment, brl(so.totalCents)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className={`text-sm font-semibold ${STATUS_CLS[so.status] ?? ""}`}>{STATUS[so.status] ?? so.status}</span>
                </div>

                {/* trilha de progresso */}
                {so.status !== "canceled" && (
                  <div className="mt-3 flex items-center gap-1">
                    {STEPS.map((st, i) => (
                      <div key={st} className="flex flex-1 items-center gap-1">
                        <div className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-green-500" : "bg-line"}`} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex justify-between text-[10px] text-muted">
                  <span>Recebida</span><span>Execução</span><span>Pronta</span><span>Entregue</span>
                </div>

                {so.status === "ready" && <p className="mt-2 rounded-lg bg-green-500/15 px-3 py-2 text-xs text-green-400">✅ Está pronta para retirada!</p>}

                {so.status === "delivered" && (
                  <RateBox so={so} onRated={reload} open={openId === so.id} onToggle={() => setOpenId(openId === so.id ? null : so.id)} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function RateBox({ so, onRated, open, onToggle }: { so: SO; onRated: () => void; open: boolean; onToggle: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (so.rating) return <p className="mt-2 text-xs text-amber-400">Você avaliou: {"⭐".repeat(so.rating)}</p>;

  async function submit() {
    if (!rating) return;
    setBusy(true);
    const res = await fetch(`/api/portal/service-orders/${so.id}/rate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
    });
    setBusy(false);
    if (res.ok) onRated();
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button onClick={onToggle} className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10">Avaliar atendimento</button>
      ) : (
        <div className="rounded-lg border border-line bg-bg/40 p-3">
          <p className="mb-1 text-xs text-muted">Como foi o serviço?</p>
          <div className="flex gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-amber-400" : "text-line"}>★</button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comentário (opcional)" className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-sm" />
          <button disabled={busy || !rating} onClick={submit} className="mt-2 rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Enviar avaliação</button>
        </div>
      )}
    </div>
  );
}
