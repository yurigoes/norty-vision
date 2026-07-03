import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { ContasClient } from "./ContasClient";

export const dynamic = "force-dynamic";

export default async function ContasAPagarPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas administradores acessam o financeiro.</p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Financeiro · Administrativo</p>
        <h1 className="mt-1 text-3xl font-semibold">Contas a pagar</h1>
        <p className="mt-2 text-muted">Lançe contas (únicas ou parceladas), anexe boleto/DANFE/comprovante e dê baixa. Status a pagar / a vencer / vencido / pago.</p>
      </header>
      <ContasClient />
    </div>
  );
}
