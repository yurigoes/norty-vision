import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { RolesClient } from "./RolesClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PermissoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O PORTEIRO DESTA TELA É O `perm` DELA NO `nav.ts` (lib/acesso.ts, aplicado
  // no layout de /app). Aqui havia um segundo porteiro à mão, exigindo
  // isOrgAdmin — e ele VENCIA, porque a página roda depois do layout. O efeito:
  // conceder a permissão fazia o item APARECER no menu e a tela responder
  // "Apenas administradores". Permissão concedida que não abre nada.

  const res = await apiFetch<{ roles: any[]; catalog: any[] }>("/api/users/roles");

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuração · Permissões"
        title="Papéis e permissões"
        description="Crie papéis personalizados para sua equipe e escolha exatamente o que cada um pode fazer no sistema."
      />

      <RolesClient
        initialRoles={res.data?.roles ?? []}
        catalog={res.data?.catalog ?? []}
      />
    </div>
  );
}
