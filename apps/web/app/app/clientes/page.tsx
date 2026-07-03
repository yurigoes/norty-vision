import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ClientesClient } from "./ClientesClient";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar clientes.
        </p>
      </div>
    );
  }

  const { data } = await apiFetch<{ items: any[] }>("/api/customers?limit=300");

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Clientes</p>
        <h1 className="mt-1 text-3xl font-semibold">Gestão de clientes</h1>
        <p className="mt-2 text-muted">
          Dados de contato e acesso ao portal. Você pode resetar a senha do
          portal — o cliente volta a entrar com o CPF/CNPJ e troca no 1º acesso.
        </p>
      </header>

      <ClientesClient initial={data?.items ?? []} />
    </div>
  );
}
