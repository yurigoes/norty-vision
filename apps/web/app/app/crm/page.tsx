import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { CrmClient } from "./CrmClient";

export const dynamic = "force-dynamic";

export default async function CentralPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  return (
    <div className="max-w-6xl">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Central de Atendimento</p>
        <h1 className="mt-1 text-3xl font-semibold">Leads &amp; Acompanhamento</h1>
        <p className="mt-2 text-muted">Leads novos, seu acompanhamento com linha do tempo, pipeline e supervisão. Lead novo chega sozinho do WhatsApp; toda interação fechada é tabulada.</p>
      </header>
      <CrmClient />
    </div>
  );
}
