import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { EmpresaContratoClient } from "./EmpresaContratoClient";

export const dynamic = "force-dynamic";

export default async function EmpresaContratoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem ver os contratos da empresa.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Empresa</p>
        <h1 className="mt-1 text-3xl font-semibold">Contrato com a plataforma</h1>
        <p className="mt-2 text-muted">
          Contrato de uso e aditivos enviados pela administração. O aceite é
          registrado eletronicamente (data, IP e hash do documento).
        </p>
      </header>
      <EmpresaContratoClient />
    </div>
  );
}
