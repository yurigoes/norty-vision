import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ComissoesClient } from "./ComissoesClient";

export const dynamic = "force-dynamic";

export default async function ComissoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem ver vendas e comissões.
        </p>
      </div>
    );
  }

  const { data } = await apiFetch<{ items: any[] }>("/api/users/sellers");

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Vendas</p>
        <h1 className="mt-1 text-3xl font-semibold">Comissões & vendas por vendedor</h1>
        <p className="mt-2 text-muted">
          Acompanhe as vendas por vendedor no período e configure o percentual
          de comissão de cada um.
        </p>
      </header>

      <ComissoesClient sellers={data?.items ?? []} />
    </div>
  );
}
