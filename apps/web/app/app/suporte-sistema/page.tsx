import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { SuporteSistemaClient } from "./SuporteSistemaClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SuporteSistemaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Suporte ao Sistema"
        title="Chamados"
        description="Abra um chamado para o suporte do sistema. A IA tenta te ajudar na hora; se precisar, encaminha para o time. Trocas de senha, e-mail e telefone são feitas com segurança por aqui."
      />
      <SuporteSistemaClient isAdmin={session.user?.isOrgAdmin ?? false} />
    </div>
  );
}
