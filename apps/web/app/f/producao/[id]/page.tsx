"use client";

// Portal da costureira — detalhe da OS. Vê a arte, descrição, ficha técnica
// (jogador/tamanho/qtd), prazo. Botão grande "Pedido pronto" no final que
// fecha a OS, congela o valor a pagar e devolve à fila.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CostureiraOrderDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "done">("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const r = await fetch(`/api/supplier-portal/production/${id}`, { credentials: "include" });
      if (r.status === 401) { router.push("/f/login"); return; }
      const d = await r.json();
      if (!r.ok) { setError(d?.error?.message ?? "Não foi possível abrir a OS"); setLoading(false); return; }
      setOrder(d.order);
      setLoading(false);
    })();
  }, [id, router]);

  async function markDone() {
    setBusy("done");
    setError(null);
    try {
      const r = await fetch(`/api/supplier-portal/production/${id}/done`, { method: "POST", credentials: "include" });
      const d = await r.json();
      if (!r.ok) { setError(d?.error?.message ?? "Falha ao marcar pronto"); return; }
      router.push("/f");
    } finally {
      setBusy("");
      setConfirm(false);
    }
  }

  if (loading) return <Centered>Carregando…</Centered>;
  if (error && !order) return <Centered><span className="text-red-300">{error}</span></Centered>;
  if (!order) return <Centered>OS não encontrada.</Centered>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/f" className="text-xs text-muted transition-colors hover:text-fg">← Voltar</Link>

      <header className="mt-4 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">OS #{order.shortCode ?? "—"}</h1>
          <p className="text-xs text-muted">{order.totalPieces ?? 0} peças{order.dueDate ? ` · prazo ${new Date(order.dueDate).toLocaleDateString("pt-BR")}` : ""}</p>
        </div>
        {order.producedAt && (
          <span className="rounded-full bg-green-500/15 px-3 py-1 text-[11px] font-semibold text-green-300">✓ produzida</span>
        )}
      </header>

      {/* Arte */}
      {order.artUrl ? (
        <section className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]">
          {/\.(png|jpg|jpeg|webp|gif)$/i.test(order.artUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.artUrl} alt="Arte" className="w-full" />
          ) : (
            <a href={order.artUrl} target="_blank" rel="noreferrer" className="block p-6 text-center text-sm text-brand hover:underline">📎 Abrir arquivo da arte ({order.artFileName ?? "anexo"})</a>
          )}
        </section>
      ) : (
        <section className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-200">
          ⚠️ Sem arte anexada ainda. Aguarde aprovação ou peça pro time.
        </section>
      )}

      {/* Itens / descrição */}
      {order.items?.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[10px] uppercase tracking-wider text-muted">Itens</p>
          <ul className="mt-2 space-y-1 text-sm">
            {order.items.map((it: any) => (
              <li key={it.id} className="flex items-center justify-between">
                <span>{it.description}</span>
                <span className="text-xs text-muted">{it.qty}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Ficha técnica / roster */}
      {order.roster?.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[10px] uppercase tracking-wider text-muted">Ficha técnica</p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-[10px] uppercase text-muted">
              <tr><th className="py-1 text-left">Nome</th><th className="text-center">Nº</th><th className="text-center">Tam</th><th className="text-right">Qtd</th></tr>
            </thead>
            <tbody>
              {order.roster.map((r: any, i: number) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="py-1">{r.playerName ?? "—"}</td>
                  <td className="text-center">{r.jerseyNumber ?? "—"}</td>
                  <td className="text-center">{r.size ?? "—"}</td>
                  <td className="text-right">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {order.notes && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[10px] uppercase tracking-wider text-muted">Observações</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{order.notes}</p>
        </section>
      )}

      {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

      {!order.producedAt && (
        confirm ? (
          <div className="rounded-2xl border border-success/40 bg-success/5 p-4 text-center shadow-[var(--shadow-sm)]">
            <p className="text-sm font-medium text-green-200">Confirma que está tudo pronto?</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setConfirm(false)} disabled={!!busy} className="flex-1 rounded-xl border border-line py-3.5 text-sm font-semibold transition hover:border-brand/50 active:scale-[.98]">Não</button>
              <button onClick={markDone} disabled={!!busy} className="flex-1 rounded-xl bg-green-600 py-3.5 text-sm font-semibold text-white shadow-[0_8px_22px_-8px_rgba(22,163,74,0.7)] transition hover:brightness-105 active:scale-[.98] disabled:opacity-50">{busy === "done" ? "Marcando…" : "Sim, está pronto"}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)} className="w-full rounded-2xl bg-green-600 py-4 text-base font-semibold text-white shadow-[0_12px_28px_-10px_rgba(22,163,74,0.75)] transition hover:brightness-105 active:scale-[.98]">
            ✓ Pedido pronto
          </button>
        )
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-muted">{children}</div>;
}
