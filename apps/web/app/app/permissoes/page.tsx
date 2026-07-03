import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { RolesClient } from "./RolesClient";

export const dynamic = "force-dynamic";

export default async function PermissoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem gerenciar
          papéis e permissões.
        </p>
      </div>
    );
  }

  const res = await apiFetch<{ roles: any[]; catalog: any[] }>("/api/users/roles");

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Permissões
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Papéis e permissões</h1>
        <p className="mt-2 text-muted">
          Crie papéis personalizados para sua equipe e escolha exatamente o que
          cada um pode fazer no sistema.
        </p>
      </header>

      <RolesClient
        initialRoles={res.data?.roles ?? []}
        catalog={res.data?.catalog ?? []}
      />
    </div>
  );
}
