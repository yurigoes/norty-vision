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
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence,
  // e foi assim que conceder a permissão passou a mostrar o item no menu sem
  // abrir a tela.

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
