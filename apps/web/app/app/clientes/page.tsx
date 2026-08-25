import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ClientesClient } from "./ClientesClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar clientes.
        </p>
      </div>
    );
  }

  // primeiro pedaço pequeno: o resto vem no "carregar mais", e o `total` diz
  // quantos existem de verdade (antes a tela mostrava 300 e chamava de tudo)
  const { data } = await apiFetch<{ items: any[]; total?: number }>("/api/customers?limit=50");

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Clientes"
        title="Gestão de clientes"
        description="Dados de contato e acesso ao portal. Você pode resetar a senha do portal — o cliente volta a entrar com o CPF/CNPJ e troca no 1º acesso."
      />

      <ClientesClient initial={data?.items ?? []} total={data?.total ?? 0} />
    </div>
  );
}
