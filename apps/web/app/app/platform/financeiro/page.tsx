import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { FinanceiroClient } from "./FinanceiroClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Master"
        title="Financeiro das assinaturas"
        description="Mensalidades das empresas: lance, marque como paga e suba a nota fiscal."
      />
      <FinanceiroClient />
    </div>
  );
}
