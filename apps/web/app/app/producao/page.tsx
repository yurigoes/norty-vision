import Link from "next/link";
import { apiFetch } from "../../../lib/api";
import { ProducaoClient } from "./ProducaoClient";
import { getOrganization } from "../../../lib/bootstrap";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const [res, org] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/production"),
    getOrganization<{ productionFeatures?: Record<string, boolean> }>(),
  ]);
  const features = org?.productionFeatures ?? {};
  // sub-módulo `financeiro` controla o botão do painel financeiro
  const showFinanceiro = features["financeiro"] !== false;
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Operação · Produção"
        title="Pedidos de produção"
        description="Do pedido à entrega, com aprovação de arte e quadro do Design. O cliente é avisado quando fica pronto."
        actions={
          showFinanceiro ? (
            <Link href="/app/producao/financeiro" className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">📊 Financeiro</Link>
          ) : null
        }
      />
      <ProducaoClient initial={res.data?.items ?? []} features={features} />
    </div>
  );
}
