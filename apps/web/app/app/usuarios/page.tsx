import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

interface MembershipBrief {
  id: string;
  status: string;
  isPrimary: boolean;
  permissions?: Record<string, boolean>;
  store: { id: string; slug: string; name: string } | null;
  role: { slug: string; name: string; permissions?: Record<string, boolean> };
}

interface CatalogGroup { group: string; items: Array<{ key: string; label: string }> }

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  memberships: MembershipBrief[];
}

interface StoreBrief {
  id: string;
  slug: string;
  name: string;
}

interface RoleBrief {
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export default async function UsuariosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem acessar a
          gestão de usuários.
        </p>
      </div>
    );
  }

  const [usersRes, storesRes, rolesRes] = await Promise.all([
    apiFetch<{ items: UserRow[] }>("/api/users"),
    apiFetch<{ items: StoreBrief[] }>("/api/stores"),
    apiFetch<{ roles: RoleBrief[]; catalog: CatalogGroup[] }>("/api/users/roles"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Usuários
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Equipe</h1>
        <p className="mt-2 text-muted">
          Pessoas com acesso ao sistema. Cada usuário pode ter um papel
          (owner, admin, gerente, recepção, etc.) e estar vinculado a uma loja.
        </p>
      </header>

      <UsersClient
        initialUsers={usersRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        roles={rolesRes.data?.roles ?? []}
        catalog={rolesRes.data?.catalog ?? []}
      />
    </div>
  );
}
