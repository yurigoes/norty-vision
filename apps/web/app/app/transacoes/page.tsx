import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { TransacoesClient, type Tx } from "./TransacoesClient";

export const dynamic = "force-dynamic";

export default async function TransacoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  const res = await apiFetch<{ items: Tx[] }>("/api/payments/transactions");
  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Financeiro</p>
        <h1 className="mt-1 text-3xl font-semibold">Transações</h1>
        <p className="mt-2 text-muted">
          Pagamentos Pix/cartão (Mercado Pago e InfinitePay) — do PDV e do crediário.
          Use "forçar/verificar" para consultar o status e dar baixa quando travar.
        </p>
      </header>
      <TransacoesClient initial={res.data?.items ?? []} />
    </div>
  );
}
