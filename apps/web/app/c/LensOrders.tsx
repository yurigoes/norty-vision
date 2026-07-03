"use client";

import { useState } from "react";

interface LensOrder {
  id: string;
  status: string;
  batchCode: string | null;
  late: boolean;
  createdAt: string;
  productDescription: string | null;
  productPhotoUrl: string | null;
  prescription: Record<string, unknown> | null;
  nfNumber: string | null;
  nfUrl: string | null;
  deliveredAt: string | null;
  deliveryConfirmedAt: string | null;
  deliverySignatureUrl: string | null;
  surveyToken: string | null;
  surveyAnswered: boolean;
}

const STEPS = ["medido", "solicitado", "chegou", "avisado", "entregue"];
const LABEL: Record<string, string> = {
  medido: "Medido", solicitado: "No laboratório", chegou: "Chegou na loja",
  avisado: "Avisado", entregue: "Entregue",
};

export function LensOrders({ orders, onRefresh }: { orders: LensOrder[]; onRefresh: () => void }) {
  if (!orders || orders.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-4 text-lg font-semibold">Meus pedidos de lente</h2>
      <div className="space-y-3">
        {orders.map((o) => (
          <OrderCard key={o.id} o={o} onRefresh={onRefresh} />
        ))}
      </div>
    </section>
  );
}

function OrderCard({ o, onRefresh }: { o: LensOrder; onRefresh: () => void }) {
  const idx = STEPS.indexOf(o.status);
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const delivered = o.status === "entregue";

  async function confirm() {
    if (!accepted) { setErr("Marque a confirmação para continuar."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/lens-orders/${o.id}/confirm-delivery`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao confirmar");
      setConfirming(false);
      onRefresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-fg">
          {LABEL[o.status] ?? o.status}
          {o.late && <span className="ml-2 text-xs text-red-300">⚠ atrasado</span>}
        </p>
        {o.batchCode && <span className="text-xs text-muted">Lote {o.batchCode}</span>}
      </div>

      <div className="mt-3 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-green-400" : "bg-line"}`} title={LABEL[s]} />
        ))}
      </div>

      {/* detalhe do produto / óculos */}
      {(o.productDescription || o.productPhotoUrl) && (
        <div className="mt-4 flex gap-3 rounded-xl border border-line bg-surface-2 p-3">
          {o.productPhotoUrl && (
            <img src={o.productPhotoUrl} alt="produto" className="h-20 w-20 rounded-lg object-cover" />
          )}
          <div className="text-sm">
            <p className="text-[10px] uppercase tracking-wider text-muted">Produto</p>
            <p className="mt-0.5 whitespace-pre-wrap">{o.productDescription ?? "Óculos"}</p>
          </div>
        </div>
      )}

      {/* nota fiscal */}
      {o.nfUrl && (
        <a href={o.nfUrl} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1 text-sm text-brand hover:underline">
          📄 Baixar nota fiscal{o.nfNumber ? ` (NF ${o.nfNumber})` : ""}
        </a>
      )}

      {/* comprovante de entrega / confirmação por aceite (1 clique) */}
      {delivered && (
        <div className="mt-3 border-t border-line/50 pt-3">
          {o.deliveryConfirmedAt ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-green-600 dark:text-green-300">
                ✓ Recebimento confirmado em {new Date(o.deliveryConfirmedAt).toLocaleDateString("pt-BR")}
              </p>
              <a
                href={`/api/portal/lens-orders/${o.id}/receipt`}
                target="_blank"
                rel="noopener"
                className="rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/50 hover:text-brand"
              >
                📄 Baixar comprovante
              </a>
              {o.surveyToken && !o.surveyAnswered && (
                <a
                  href={`/p/${o.surveyToken}`}
                  target="_blank"
                  rel="noopener"
                  className="btn-grad px-3 py-1.5 text-xs"
                >
                  ⭐ Avaliar
                </a>
              )}
              {o.surveyAnswered && <span className="text-xs text-muted">✓ avaliado</span>}
            </div>
          ) : !confirming ? (
            <button onClick={() => setConfirming(true)} className="btn-grad px-4 py-2">
              Confirmar recebimento
            </button>
          ) : (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>Confirmo que recebi meu produto. Este aceite eletrônico tem validade legal (Lei 14.063/2020).</span>
              </label>
              {err && <p className="text-xs font-medium text-danger">{err}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setConfirming(false); setErr(null); }} className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-fg">Cancelar</button>
                <button onClick={confirm} disabled={busy} className="btn-grad px-4 py-1.5 text-xs">
                  {busy ? "Confirmando..." : "Confirmar recebimento"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted">{new Date(o.createdAt).toLocaleDateString("pt-BR")}</p>
    </div>
  );
}
