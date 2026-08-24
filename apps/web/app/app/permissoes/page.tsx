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
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="card text-muted">
          Apenas administradores ou owners da organização podem gerenciar
          papéis e permissões.
        </p>
      </div>
    );
  }

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
