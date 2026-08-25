import { apiFetch } from "../../../lib/api";
import { ProducaoClient } from "./ProducaoClient";
import { getOrganization } from "../../../lib/bootstrap";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const [res, org] = await Promise.all([
    // primeiro pedaço pequeno: o resto vem no "carregar mais"
    apiFetch<{ items: any[]; total?: number }>("/api/production?limit=50"),
    getOrganization<{ productionFeatures?: Record<string, boolean> }>(),
  ]);
  const features = org?.productionFeatures ?? {};
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Operação · Produção"
        title="Pedidos de produção"
        description="Do pedido à entrega, com aprovação de arte e quadro do Design. O cliente é avisado quando fica pronto."
      />
      <ProducaoClient initial={res.data?.items ?? []} total={res.data?.total ?? 0} features={features} />
    </div>
  );
}
