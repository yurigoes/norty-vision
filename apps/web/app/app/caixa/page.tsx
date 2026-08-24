import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { CaixaClient } from "./CaixaClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Store { id: string; name: string }

export default async function CaixaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());

  const storesRes = await apiFetch<{ items: Store[] }>("/api/stores");

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="PDV"
        title="Caixa diário"
        description="Abra o caixa no início do dia e feche conferindo os totais por meio de pagamento."
      />
      <CaixaClient stores={storesRes.data?.items ?? []} />
    </div>
  );
}
