import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";
import { AlocacoesClient } from "./AlocacoesClient";

export const dynamic = "force-dynamic";

export default async function AlocacoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem gerenciar
          alocações.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Alocações / Cessão de mão de obra"
        description="Funcionário contratado pela sua empresa (empregadora legal) mas que trabalha em outra (tomadora). A folha, o ponto fiscal (AFD/AEJ) e o eSocial continuam na sua empresa; a tomadora apenas acompanha as horas."
      />
      <AlocacoesClient />
    </div>
  );
}
