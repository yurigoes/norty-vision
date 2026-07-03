import Link from "next/link";
import { apiFetch } from "../../../lib/api";
import { ProducaoClient } from "./ProducaoClient";

export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const [res, meRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/production"),
    apiFetch<{ organization: { productionFeatures?: Record<string, boolean> } | null }>("/api/organizations/me"),
  ]);
  const features = meRes.data?.organization?.productionFeatures ?? {};
  // sub-módulo `financeiro` controla o botão do painel financeiro
  const showFinanceiro = features["financeiro"] !== false;
  return (
    <div className="max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Operação · Produção</p>
          <h1 className="mt-1 text-3xl font-semibold">Pedidos de produção</h1>
          <p className="mt-2 text-muted">Do pedido à entrega, com aprovação de arte e quadro do Design. O cliente é avisado quando fica pronto.</p>
        </div>
        {showFinanceiro && (
          <Link href="/app/producao/financeiro" className="shrink-0 rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">📊 Financeiro</Link>
        )}
      </header>
      <ProducaoClient initial={res.data?.items ?? []} features={features} />
    </div>
  );
}
