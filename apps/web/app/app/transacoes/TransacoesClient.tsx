"use client";

import { useEffect, useState } from "react";

export interface Tx {
  kind: "sale" | "installment";
  provider?: "mp" | "infinitepay";
  id: string;
  origin: string;
  method: string;
  amountCents: number;
  status: string;
  mpPaymentId: string | null;
  ref: string | null;
  who: string | null;
  at: string;
}

function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: "Pago", cls: "bg-green-500/20 text-green-300" },
  approved: { label: "Aprovado", cls: "bg-green-500/20 text-green-300" },
  pending: { label: "Pendente", cls: "bg-amber-500/20 text-amber-300" },
  failed: { label: "Falhou", cls: "bg-red-500/20 text-red-300" },
  rejected: { label: "Recusado", cls: "bg-red-500/20 text-red-300" },
  canceled: { label: "Cancelado", cls: "bg-gray-500/20 text-gray-300" },
  expired: { label: "Expirado", cls: "bg-gray-500/20 text-gray-300" },
};

const STATUS_LABEL: Record<string, string> = { paid: "Pago", approved: "Aprovado", pending: "Pendente", failed: "Falhou", rejected: "Recusado", canceled: "Cancelado", expired: "Expirado" };

export function TransacoesClient({ initial }: { initial: Tx[] }) {
  const [rows, setRows] = useState<Tx[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [org, setOrg] = useState<{ name: string; logoUrl: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/organizations/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.organization && setOrg(d.organization)).catch(() => {});
  }, []);

  async function force(t: Tx) {
    setBusy(t.id);
    try {
      const url = t.provider === "infinitepay"
        ? `/api/payments/infinitepay/${t.id}/check`
        : `/api/payments/transactions/${t.kind}/${t.id}/force`;
      const res = await fetch(url, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.status) {
        setRows((r) => r.map((x) => (x.id === t.id ? { ...x, status: d.status } : x)));
      }
    } finally { setBusy(null); }
  }

  const shown = filter === "all" ? rows : rows.filter((r) => [r.status].includes(filter));
  const totalShown = shown.reduce((s, r) => s + r.amountCents, 0);
  const totalPaid = shown.filter((r) => ["paid", "approved"].includes(r.status)).reduce((s, r) => s + r.amountCents, 0);
  const FILTER_LABEL: Record<string, string> = { all: "Todas", pending: "Pendentes", paid: "Pagas", failed: "Falhas" };

  return (
    <div className="space-y-3">
      <style dangerouslySetInnerHTML={{ __html: "@media print { @page { margin: 0; } html, body { background:#fff !important; } .no-print { display:none !important; } .print-only { display:block !important; } .print-report { padding: 14mm !important; } }" }} />
      <div className="no-print flex flex-wrap items-center gap-2">
        {[
          ["all", "Todas"],
          ["pending", "Pendentes"],
          ["paid", "Pagas"],
          ["failed", "Falhas"],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === k ? "border-brand text-brand" : "border-line text-muted hover:text-fg"}`}>{l}</button>
        ))}
        <button onClick={() => window.print()} className="ml-auto rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90">🖨️ PDF / Imprimir</button>
      </div>

      {/* versão branded só pra impressão */}
      <div className="print-only hidden">
        <div className="print-report bg-white p-8 text-black">
          <header className="mb-6 flex items-center justify-between border-b border-gray-300 pb-4">
            <div>
              <h1 className="text-xl font-bold">{org?.name ?? "Transações"}</h1>
              <p className="text-sm text-gray-600">Relatório de transações — {FILTER_LABEL[filter] ?? "Todas"}</p>
              <p className="text-sm font-medium">Emitido em {new Date().toLocaleString("pt-BR")}</p>
            </div>
            {org?.logoUrl && <img src={org.logoUrl} alt="" className="h-14 w-auto max-w-[160px] object-contain" />}
          </header>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-gray-600">
                <th className="py-2 pr-2">Quando</th><th className="py-2 pr-2">Origem</th><th className="py-2 pr-2">Ref./Cliente</th><th className="py-2 pr-2">Meio</th><th className="py-2 pr-2 text-right">Valor</th><th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-500">Nenhuma transação.</td></tr> : shown.map((t) => (
                <tr key={t.id} className="border-b border-gray-200">
                  <td className="py-1.5 pr-2">{new Date(t.at).toLocaleString("pt-BR")}</td>
                  <td className="py-1.5 pr-2">{t.origin}</td>
                  <td className="py-1.5 pr-2">{[t.ref, t.who].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-1.5 pr-2">{t.method}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{brl(t.amountCents)}</td>
                  <td className="py-1.5">{STATUS_LABEL[t.status] ?? t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end gap-8 border-t border-gray-300 pt-3 text-sm">
            <span>Total exibido: <strong>{brl(totalShown)}</strong></span>
            <span>Total pago: <strong>{brl(totalPaid)}</strong></span>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="no-print rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Nenhuma transação.</p>
      ) : (
        <div className="no-print overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Ref. / Cliente</th>
                <th className="px-4 py-3">Meio</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const s = STATUS[t.status] ?? { label: t.status, cls: "bg-line text-muted" };
                const pending = ["pending"].includes(t.status);
                return (
                  <tr key={t.id} className="border-b border-line/60">
                    <td className="px-4 py-3 text-xs text-muted">{new Date(t.at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">{t.origin}</td>
                    <td className="px-4 py-3">{[t.ref, t.who].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-3 text-xs">{t.method}</td>
                    <td className="px-4 py-3 text-right font-medium">{brl(t.amountCents)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      {!["paid", "approved"].includes(t.status) && (t.mpPaymentId || t.provider === "infinitepay") && (
                        <button onClick={() => force(t)} disabled={busy === t.id} className="rounded-lg border border-line px-3 py-1 text-xs transition hover:border-brand disabled:opacity-50">
                          {busy === t.id ? "..." : t.provider === "infinitepay" ? "verificar" : "forçar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
