import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";
import { AssiduidadeClient } from "./AssiduidadeClient";

export const dynamic = "force-dynamic";

export default async function AssiduidadePage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem acessar a
          assiduidade.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Assiduidade (bônus)"
        description="Calcula quem recebe o bônus de assiduidade no mês, gera os recibos em lote e libera para assinatura no portal do colaborador."
      />
      <AssiduidadeClient />
    </div>
  );
}
