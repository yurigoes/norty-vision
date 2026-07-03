import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { FinanceiroClient } from "./FinanceiroClient";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");
  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master</p>
        <h1 className="mt-1 text-3xl font-semibold">Financeiro das assinaturas</h1>
        <p className="mt-2 text-muted">Mensalidades das empresas: lance, marque como paga e suba a nota fiscal.</p>
      </header>
      <FinanceiroClient />
    </div>
  );
}
