import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VoipAdminClient } from "./VoipAdminClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function VoipAdminPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) redirect("/app");
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Call Center · Configuração"
        title="Linhas, números e grupos"
        description="Configure os trunks SIP da empresa, os números (DIDs) e os grupos de ramal que recebem as chamadas. As mudanças se propagam pro PABX em até 30 segundos."
      />
      <VoipAdminClient />
    </div>
  );
}
