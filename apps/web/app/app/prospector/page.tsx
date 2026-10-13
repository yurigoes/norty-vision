import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { ProspectorClient } from "./ProspectorClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ProspectorPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Central de Atendimento · Prospecção"
        title="Motor de busca de leads (B2B)"
        description={<>Busca empresas por nicho + cidade em fontes públicas grátis (OpenStreetMap) e joga na fila de <b>Leads novos</b>. Respeita opt-out (LGPD) — só dado público de empresa.</>}
      />
      <ProspectorClient isMaster={session.master !== null} />
    </div>
  );
}
