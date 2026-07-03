import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { PesquisasClient } from "./PesquisasClient";

export const dynamic = "force-dynamic";

export default async function PesquisasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Qualidade</p>
        <h1 className="mt-1 text-3xl font-semibold">Pesquisas de satisfação</h1>
        <p className="mt-2 text-muted">
          NPS por período e nota dos vendedores. As pesquisas são enviadas
          automaticamente na entrega do pedido de lente.
        </p>
      </header>
      <PesquisasClient />
    </div>
  );
}
