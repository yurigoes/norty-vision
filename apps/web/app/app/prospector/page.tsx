import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { ProspectorClient } from "./ProspectorClient";

export const dynamic = "force-dynamic";

export default async function ProspectorPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas administradores configuram a prospecção.</p></div>;
  }
  return (
    <div className="max-w-5xl">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Central de Atendimento · Prospecção</p>
        <h1 className="mt-1 text-3xl font-semibold">Motor de busca de leads (B2B)</h1>
        <p className="mt-2 text-muted">Busca empresas por nicho + cidade em fontes públicas grátis (OpenStreetMap) e joga na fila de <b>Leads novos</b>. Respeita opt-out (LGPD) — só dado público de empresa.</p>
      </header>
      <ProspectorClient isMaster={session.master !== null} />
    </div>
  );
}
