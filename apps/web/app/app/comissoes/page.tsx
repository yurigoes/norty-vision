import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ComissoesClient } from "./ComissoesClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ComissoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
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
      <PageHeader
        eyebrow="Vendas"
        title={<>Comissões & vendas por vendedor</>}
        description="Acompanhe as vendas por vendedor no período e configure o percentual de comissão de cada um."
      />

      <ComissoesClient sellers={data?.items ?? []} />
    </div>
  );
}
