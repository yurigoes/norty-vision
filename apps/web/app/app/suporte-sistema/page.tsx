import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { SuporteSistemaClient } from "./SuporteSistemaClient";

export const dynamic = "force-dynamic";

export default async function SuporteSistemaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Suporte ao Sistema</p>
        <h1 className="mt-1 text-3xl font-semibold">Chamados</h1>
        <p className="mt-2 text-muted">Abra um chamado para o suporte do sistema. A IA tenta te ajudar na hora; se precisar, encaminha para o time. Trocas de senha, e-mail e telefone são feitas com segurança por aqui.</p>
      </header>
      <SuporteSistemaClient isAdmin={session.user?.isOrgAdmin ?? false} />
    </div>
  );
}
