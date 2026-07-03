import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { MasterSuporteClient } from "./MasterSuporteClient";

export const dynamic = "force-dynamic";

export default async function MasterSuportePage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (session.master === null) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas o suporte do sistema (master) acessa esta área.</p></div>;
  }
  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master · Suporte</p>
        <h1 className="mt-1 text-3xl font-semibold">Chamados das empresas</h1>
        <p className="mt-2 text-muted">Chamados abertos pelas empresas. Responda e resolva — respostas de dúvidas viram base para a IA atender sozinha na próxima.</p>
      </header>
      <MasterSuporteClient />
    </div>
  );
}
