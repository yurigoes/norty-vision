import Link from "next/link";
import { apiFetch } from "../../../../lib/api";
import { AccountActions } from "./AccountActions";
import { InstallmentPay } from "./InstallmentPay";

export const dynamic = "force-dynamic";

interface Installment {
  id: string;
  number: number;
  dueDate: string;
  amountCents: string;
  paidAmountCents: string;
  status: string;
  paidAt: string | null;
}

interface Purchase {
  id: string;
  totalCents: string;
  downPaymentCents: string;
  financedCents: string;
  installmentsCount: number;
  status: string;
  createdAt: string;
  installments: Installment[];
}

interface Account {
  id: string;
  document: string;
  holderName: string;
  limitCents: string;
  usedCents: string;
  status: string;
  score: number;
  blockedReason: string | null;
  guarantorName: string | null;
  purchases: Purchase[];
  attention?: AttentionEvent[];
}

interface AttentionEvent {
  id: string;
  eventType: string;
  payload: any;
  createdAt: string;
}

function brl(cents: string | number): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function CreditAccountDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await apiFetch<{ account: Account | null }>(`/api/credit/accounts/${id}`);
  const acc = data?.account;

  if (!acc) {
    return (
      <div className="max-w-3xl">
        <Link href="/app/crediario" className="text-sm text-brand hover:underline">← voltar</Link>
        <p className="mt-8 rounded-2xl border border-line bg-surface p-6 text-muted">Conta não encontrada.</p>
      </div>
    );
  }

  const available = Number(acc.limitCents) - Number(acc.usedCents);
  const today = new Date();

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link href="/app/crediario" className="text-sm text-brand hover:underline">← Crediário</Link>
        <header className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">{acc.holderName}</h1>
            <p className="font-mono text-sm text-muted">{acc.document}</p>
          </div>
          <AccountActions account={{ id: acc.id, status: acc.status, limitCents: acc.limitCents }} />
        </header>
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Limite" value={brl(acc.limitCents)} />
        <Stat label="Usado" value={brl(acc.usedCents)} />
        <Stat label="Disponível" value={brl(available)} highlight />
        <Stat label="Score" value={`${acc.score}/100`} />
      </section>

      {acc.status === "blocked" && acc.blockedReason && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Bloqueado: {acc.blockedReason}
        </p>
      )}

      {Array.isArray(acc.attention) && acc.attention.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="mb-3 text-sm font-semibold text-amber-300">⚠ Pontos de atenção ({acc.attention.length})</h2>
          <ul className="space-y-1.5 text-xs text-muted">
            {acc.attention.map((ev) => {
              const p = ev.payload ?? {};
              const when = new Date(ev.createdAt).toLocaleDateString("pt-BR");
              let txt = "Ocorrência";
              if (p.kind === "late_payment") txt = `Pagamento em atraso — parcela ${p.installment}`;
              else if (p.kind === "discount_granted") txt = `Desconto concedido em juros — parcela ${p.installment} (${brl(p.manualDiscountCents ?? 0)})`;
              else if (p.kind === "due_adjusted") txt = `Vencimento ajustado — parcela ${p.installment}${p.reason ? ` · ${p.reason}` : ""}`;
              return (
                <li key={ev.id} className="flex items-start justify-between gap-3">
                  <span>{txt}</span>
                  <span className="shrink-0 font-mono text-[10px]">{when}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Compras ({acc.purchases.length})</h2>
        {acc.purchases.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhuma compra no crediário.</p>
        ) : (
          <div className="space-y-4">
            {acc.purchases.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{brl(p.totalCents)} em {p.installmentsCount}x</p>
                    <p className="text-xs text-muted">
                      Entrada {brl(p.downPaymentCents)} · Financiado {brl(p.financedCents)} ·{" "}
                      {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{p.status}</span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                        <th className="pb-2 pr-3">#</th>
                        <th className="pb-2 pr-3">Vencimento</th>
                        <th className="pb-2 pr-3">Valor</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.installments.map((inst) => {
                        const due = new Date(inst.dueDate);
                        const daysToDue = Math.floor((due.getTime() - today.getTime()) / 86400_000);
                        let sit = "ok";
                        if (inst.status === "paid") sit = "paid";
                        else if (daysToDue < 0) sit = "late";
                        else if (daysToDue <= 5) sit = "soon";
                        return (
                          <tr key={inst.id} className="border-t border-line/40">
                            <td className="py-2 pr-3 font-mono">{inst.number}</td>
                            <td className="py-2 pr-3">{due.toLocaleDateString("pt-BR")}</td>
                            <td className="py-2 pr-3">{brl(inst.amountCents)}</td>
                            <td className="py-2 pr-3"><InstBadge sit={sit} /></td>
                            <td className="py-2 text-right">
                              {inst.status !== "paid" && <InstallmentPay installmentId={inst.id} amountCents={inst.amountCents} dueDate={inst.dueDate} />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card ${highlight ? "border-brand/50" : ""}`}>
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${highlight ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

function InstBadge({ sit }: { sit: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    paid: { cls: "bg-green-500/20 text-green-300", label: "pago" },
    ok: { cls: "bg-line text-muted", label: "em dia" },
    soon: { cls: "bg-orange-500/20 text-orange-300", label: "a vencer" },
    late: { cls: "bg-red-500/20 text-red-300", label: "vencido" },
  };
  const m = map[sit] ?? map.ok;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${m.cls}`}>{m.label}</span>;
}
