import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { LensOrdersClient } from "./LensOrdersClient";

export const dynamic = "force-dynamic";

export default async function PedidosLentePage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar pedidos de lente.
        </p>
      </div>
    );
  }

  const [ordersRes, supRes, custRes, batchRes, prodRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/optical/orders"),
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/customers?limit=300"),
    apiFetch<{ items: any[] }>("/api/optical/batches"),
    apiFetch<{ items: any[] }>("/api/products?activeOnly=true"),
  ]);

  const suppliers = supRes.data?.items ?? [];

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Ótica</p>
        <h1 className="mt-1 text-3xl font-semibold">Pedidos de lente</h1>
        <p className="mt-2 text-muted">
          Medidas, anexo do exame e acompanhamento do status (medido →
          solicitado → chegou → avisado → entregue) com lotes pro laboratório.
        </p>
      </header>

      <LensOrdersClient
        initialOrders={ordersRes.data?.items ?? []}
        initialBatches={batchRes.data?.items ?? []}
        doctors={suppliers.filter((s) => s.type === "medico")}
        labs={suppliers.filter((s) => s.type === "laboratorio")}
        customers={custRes.data?.items ?? []}
        products={prodRes.data?.items ?? []}
      />
    </div>
  );
}
