import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { CrmClient } from "./CrmClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CentralPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Central de Atendimento"
        title={<>Leads &amp; Acompanhamento</>}
        description="Leads novos, seu acompanhamento com linha do tempo, pipeline e supervisão. Lead novo chega sozinho do WhatsApp; toda interação fechada é tabulada."
      />
      <CrmClient />
    </div>
  );
}
