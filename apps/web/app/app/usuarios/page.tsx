import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { UsersClient } from "./UsersClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

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
  if (!session.authenticated) redirect(await loginPath());
  // O PORTEIRO DESTA TELA É O `perm` DELA NO `nav.ts` (lib/acesso.ts, aplicado
  // no layout de /app). Aqui havia um segundo porteiro à mão, exigindo
  // isOrgAdmin — e ele VENCIA, porque a página roda depois do layout. O efeito:
  // conceder a permissão fazia o item APARECER no menu e a tela responder
  // "Apenas administradores". Permissão concedida que não abre nada.

  const [usersRes, storesRes, rolesRes] = await Promise.all([
    apiFetch<{ items: UserRow[] }>("/api/users"),
    apiFetch<{ items: StoreBrief[] }>("/api/stores"),
    apiFetch<{ roles: RoleBrief[]; catalog: CatalogGroup[] }>("/api/users/roles"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuração · Usuários"
        title="Equipe"
        description="Pessoas com acesso ao sistema. Cada usuário pode ter um papel (owner, admin, gerente, recepção, etc.) e estar vinculado a uma loja."
      />

      <UsersClient
        initialUsers={usersRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        roles={rolesRes.data?.roles ?? []}
        catalog={rolesRes.data?.catalog ?? []}
      />
    </div>
  );
}
