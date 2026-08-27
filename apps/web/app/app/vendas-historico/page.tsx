import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VendasHistoricoClient } from "./VendasHistoricoClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function VendasHistoricoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return <div className="max-w-3xl"><p className="card p-6 text-muted">Apenas administradores podem importar vendas históricas.</p></div>;
  }
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Vendas · Histórico"
        title="Importar vendas antigas"
        description={<>Cole o relatório de vendas do sistema antigo. Importamos item a item, só para controle e relatório — <b>não afeta</b> estoque, caixa, fiscal nem comissões.</>}
      />
      <VendasHistoricoClient />
    </div>
  );
}
