"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { moduleLabel, moduleDescription } from "../../../../lib/modules";
import { useDialog } from "../../../../components/SystemDialog";

function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Página de um módulo NÃO liberado: explica pra que serve e oferece comprar
 * à la carte (preço definido pelo master) ou trocar de plano.
 */
export default function ModuloPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const dialog = useDialog();
  const [price, setPrice] = useState<{ priceCents: number; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null } | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  async function buy(method: "pix" | "card") {
    setBusy(true);
    try {
      const res = await fetch("/api/subscriptions/module-offers/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ moduleKey: key, method }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao gerar pagamento", "error"); return; }
      if (method === "card") { if (d.initPoint) window.open(d.initPoint, "_blank"); setPayOpen(false); }
      else setPix({ qrCode: d.qrCode ?? null, qrCodeBase64: d.qrCodeBase64 ?? null });
    } finally { setBusy(false); }
  }

  useEffect(() => {
    fetch("/api/module-pricing", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const found = (d?.items ?? []).find((p: any) => p.moduleKey === key);
        if (found) setPrice({ priceCents: found.priceCents, active: found.active });
      })
      .catch(() => {});
  }, [key]);

  const label = moduleLabel(key);
  const desc = moduleDescription(key);
  const hasPrice = price && price.active && price.priceCents > 0;

  return (
    <main className="mx-auto max-w-2xl">
      <Link href="/app/billing" className="text-sm text-muted hover:text-fg">← Assinatura</Link>
      <div className="card mt-4 p-6">
        <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">🔒 Não liberado no seu plano</span>
        <h1 className="mt-3 text-2xl font-semibold">{label}</h1>
        <p className="mt-2 text-muted">{desc}</p>

        <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4">
          {hasPrice ? (
            <p className="text-sm">À la carte por <span className="text-xl font-semibold text-brand">{brl(price!.priceCents)}</span><span className="text-muted">/mês</span></p>
          ) : (
            <p className="text-sm text-muted">Fale com a gente para liberar este módulo no seu plano.</p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {hasPrice ? (
            <button onClick={() => setPayOpen(true)} className="btn-grad px-5 py-2.5">
              Comprar à la carte
            </button>
          ) : (
            <Link href="/app/billing" className="btn-grad px-5 py-2.5">Quero este módulo</Link>
          )}
          <Link
            href="/app/billing"
            className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold transition hover:border-brand"
          >
            Alterar meu plano
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">Após o pagamento, o módulo é liberado automaticamente e aparece no menu lateral.</p>
      </div>

      {payOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setPayOpen(false); setPix(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {pix ? (
              <>
                <h3 className="text-base font-semibold">Pix gerado</h3>
                <p className="mt-1 text-xs text-muted">Pague e o módulo é liberado automaticamente.</p>
                {pix.qrCodeBase64 ? <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Pix" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" /> : <p className="mt-4 text-xs text-muted">QR indisponível — use o código.</p>}
                {pix.qrCode && <button onClick={() => navigator.clipboard?.writeText(pix.qrCode!).then(() => dialog.toast("Código copiado", "success"))} className="mt-4 w-full break-all rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-muted transition hover:border-brand">{pix.qrCode}</button>}
                <button onClick={() => { setPayOpen(false); setPix(null); }} className="btn-grad mt-3 w-full">Concluir</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">Como deseja pagar {price ? brl(price.priceCents) : ""}?</h3>
                <div className="mt-4 grid gap-2">
                  <button disabled={busy} onClick={() => buy("pix")} className="rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-brand disabled:opacity-50"><span className="block text-sm font-medium">Pix</span><span className="block text-xs text-muted">QR na hora, liberação automática.</span></button>
                  <button disabled={busy} onClick={() => buy("card")} className="rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-brand disabled:opacity-50"><span className="block text-sm font-medium">Cartão</span><span className="block text-xs text-muted">Abre o checkout do Mercado Pago.</span></button>
                </div>
                <button onClick={() => setPayOpen(false)} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">cancelar</button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
