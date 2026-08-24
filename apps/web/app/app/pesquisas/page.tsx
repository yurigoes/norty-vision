import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { PesquisasClient } from "./PesquisasClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PesquisasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Qualidade"
        title="Pesquisas de satisfação"
        description="NPS por período e nota dos vendedores. As pesquisas são enviadas automaticamente na entrega do pedido de lente."
      />
      <PesquisasClient />
    </div>
  );
}
