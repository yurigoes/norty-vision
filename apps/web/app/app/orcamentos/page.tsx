import { apiFetch } from "../../../lib/api";
import { OrcamentosClient } from "./OrcamentosClient";

export const dynamic = "force-dynamic";

export default async function OrcamentosPage() {
  const res = await apiFetch<{ items: any[] }>("/api/quotes");
  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Comercial · Orçamentos</p>
        <h1 className="mt-1 text-3xl font-semibold">Orçamentos</h1>
        <p className="mt-2 text-muted">Monte o orçamento, gere o PDF e envie por WhatsApp ou e-mail com a marca da sua empresa.</p>
      </header>
      <OrcamentosClient initial={res.data?.items ?? []} />
    </div>
  );
}
