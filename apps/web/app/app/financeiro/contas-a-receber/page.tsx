import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { ReceberClient } from "./ReceberClient";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ContasAReceberPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas administradores acessam o financeiro.</p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Financeiro · Administrativo"
        title="Contas a receber"
        description="Lance títulos a receber (únicos, parcelados ou recorrentes), anexe comprovante e dê baixa no recebimento. Status a receber / a vencer / atrasado / recebido."
      />
      <ReceberClient />
    </div>
  );
}
