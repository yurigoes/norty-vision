import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { MasterSuporteClient } from "./MasterSuporteClient";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MasterSuportePage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (session.master === null) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas o suporte do sistema (master) acessa esta área.</p></div>;
  }
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Master · Suporte"
        title="Chamados das empresas"
        description="Chamados abertos pelas empresas. Responda e resolva — respostas de dúvidas viram base para a IA atender sozinha na próxima."
      />
      <MasterSuporteClient />
    </div>
  );
}
