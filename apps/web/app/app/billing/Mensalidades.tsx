"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function competenceLabel(c: string): string {
  const [y, m] = c.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mi = Math.max(1, Math.min(12, parseInt(m ?? "1", 10))) - 1;
  return `${months[mi]}/${y}`;
}
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Em aberto", cls: "bg-amber-500/15 text-amber-300" },
  paid: { label: "Paga", cls: "bg-green-500/15 text-green-300" },
  canceled: { label: "Cancelada", cls: "bg-line text-muted" },
};

/** Mensalidades da empresa: recibo estilizado + nota fiscal pra baixar. */
export function Mensalidades() {
  const [items, setItems] = useState<any[] | null>(null);
  const load = () => fetch("/api/subscription-invoices/mine", { credentials: "include", headers: { "x-no-loading": "1" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => setItems(d?.items ?? []))
    .catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold">Mensalidades</h2>
      {items === null ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhuma mensalidade lançada ainda.</p>
      ) : (
        <div className="space-y-2">
          {items.map((inv) => {
            const st = STATUS[inv.status] ?? { label: inv.status, cls: "bg-line text-muted" };
            return (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:bg-surface-2">
                <div>
                  <p className="font-medium">{competenceLabel(inv.competence)} <span className="ml-1 text-sm text-muted">{brl(inv.amountCents)}</span></p>
                  <p className="text-xs text-muted">
                    {inv.status === "paid" && inv.paidAt ? `Paga em ${new Date(inv.paidAt).toLocaleDateString("pt-BR")}` : inv.dueDate ? `Vence ${new Date(inv.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}
                    {inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${st.cls}`}>{st.label}</span>
                  {inv.status !== "paid" && inv.status !== "canceled" && <PagarMensalidade id={inv.id} onPaid={load} />}
                  {inv.status === "paid" && (
                    <a href={`/api/subscription-invoices/${inv.id}/receipt`} target="_blank" rel="noreferrer" className="rounded-xl border border-line px-3 py-1 text-xs transition hover:border-brand/60 hover:text-brand">Recibo</a>
                  )}
                  {inv.nfUrl
                    ? <a href={inv.nfUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-line px-3 py-1 text-xs text-sky-400 transition hover:border-brand/60">Nota fiscal</a>
                    : <span className="rounded-xl border border-line px-3 py-1 text-xs text-muted/60">NF pendente</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Pagamento da mensalidade via MP da plataforma (Pix com QR ou cartão por link). */
function PagarMensalidade({ id, onPaid }: { id: string; onPaid: () => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null } | null>(null);

  async function pay(method: "pix" | "card") {
    setBusy(true);
    try {
      const res = await fetch(`/api/subscription-invoices/${id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ method }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao gerar pagamento", "error"); return; }
      if (method === "card") { if (d.initPoint) window.open(d.initPoint, "_blank"); setOpen(false); }
      else setPix({ qrCode: d.qrCode ?? null, qrCodeBase64: d.qrCodeBase64 ?? null });
    } finally { setBusy(false); }
  }
  function close() { setOpen(false); setPix(null); onPaid(); }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-grad px-3 py-1 text-xs">Pagar</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={close}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-lg" onClick={(e) => e.stopPropagation()}>
            {pix ? (
              <>
                <h3 className="text-base font-semibold">Pix gerado</h3>
                <p className="mt-1 text-xs text-muted">Pague e a baixa é automática. Pode fechar depois de pagar.</p>
                {pix.qrCodeBase64 ? <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Pix" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" /> : <p className="mt-4 text-xs text-muted">QR indisponível — use o código.</p>}
                {pix.qrCode && <button onClick={() => navigator.clipboard?.writeText(pix.qrCode!).then(() => dialog.toast("Código copiado", "success"))} className="mt-4 w-full break-all rounded-xl border border-line bg-surface-2 px-3 py-2 text-[11px] text-muted transition hover:border-brand">{pix.qrCode}</button>}
                <button onClick={close} className="btn-grad mt-3 w-full py-2 text-sm">Concluir</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">Como deseja pagar?</h3>
                <div className="mt-4 grid gap-2">
                  <button disabled={busy} onClick={() => pay("pix")} className="rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-brand disabled:opacity-50"><span className="block text-sm font-medium">Pix</span><span className="block text-xs text-muted">QR na hora, baixa automática.</span></button>
                  <button disabled={busy} onClick={() => pay("card")} className="rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-brand disabled:opacity-50"><span className="block text-sm font-medium">Cartão</span><span className="block text-xs text-muted">Abre o checkout do Mercado Pago.</span></button>
                </div>
                <button onClick={close} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">cancelar</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
