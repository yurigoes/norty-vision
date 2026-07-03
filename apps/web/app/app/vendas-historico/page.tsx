import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VendasHistoricoClient } from "./VendasHistoricoClient";

export const dynamic = "force-dynamic";

export default async function VendasHistoricoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas administradores podem importar vendas históricas.</p></div>;
  }
  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Vendas · Histórico</p>
        <h1 className="mt-1 text-3xl font-semibold">Importar vendas antigas</h1>
        <p className="mt-2 text-muted">Cole o relatório de vendas do sistema antigo. Importamos item a item, só para controle e relatório — <b>não afeta</b> estoque, caixa, fiscal nem comissões.</p>
      </header>
      <VendasHistoricoClient />
    </div>
  );
}
