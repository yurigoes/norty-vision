import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VoipAdminClient } from "./VoipAdminClient";

export const dynamic = "force-dynamic";

export default async function VoipAdminPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) redirect("/app");
  return (
    <div className="max-w-5xl">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Call Center · Configuração</p>
        <h1 className="mt-1 text-3xl font-semibold">Linhas, números e grupos</h1>
        <p className="mt-2 text-muted">
          Configure os trunks SIP da empresa, os números (DIDs) e os grupos de ramal que recebem as chamadas.
          As mudanças se propagam pro PABX em até 30 segundos.
        </p>
      </header>
      <VoipAdminClient />
    </div>
  );
}
