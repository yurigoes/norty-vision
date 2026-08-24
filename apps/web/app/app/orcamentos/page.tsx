import { apiFetch } from "../../../lib/api";
import { OrcamentosClient } from "./OrcamentosClient";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function OrcamentosPage() {
  const res = await apiFetch<{ items: any[] }>("/api/quotes");
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Comercial · Orçamentos"
        title="Orçamentos"
        description="Monte o orçamento, gere o PDF e envie por WhatsApp ou e-mail com a marca da sua empresa."
      />
      <OrcamentosClient initial={res.data?.items ?? []} />
    </div>
  );
}
