import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { EmpresaContratoClient } from "./EmpresaContratoClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EmpresaContratoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores podem ver os contratos da empresa.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Empresa"
        title="Contrato com a plataforma"
        description="Contrato de uso e aditivos enviados pela administração. O aceite é registrado eletronicamente (data, IP e hash do documento)."
      />
      <EmpresaContratoClient />
    </div>
  );
}
