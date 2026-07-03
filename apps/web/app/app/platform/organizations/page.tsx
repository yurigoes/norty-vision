import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { CreateOrgForm } from "./CreateOrgForm";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  document: string | null;
  status: string;
  planCode: string;
  createdAt: string;
  _count: { stores: number; memberships: number };
}

export default async function OrganizationsPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const { data } = await apiFetch<{ items: OrgRow[] }>("/api/organizations");
  const orgs = data?.items ?? [];

  return (
    <div className="max-w-5xl space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Master · Organizações
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          Empresas na plataforma
        </h1>
        <p className="mt-2 text-muted">
          Cada empresa tem suas próprias lojas, usuários, leads e dados —
          isolados via Row-Level Security no Postgres.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Cadastradas ({orgs.length})
        </h2>
        {orgs.length === 0 ? (
          <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
            Nenhuma organização criada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="px-4 py-3">Lojas</th>
                  <th className="px-4 py-3">Usuários</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="border-t border-line/50">
                    <td className="px-4 py-3 font-medium">
                      {o.name}
                      {o.legalName && (
                        <div className="text-xs text-muted">{o.legalName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {o.slug}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {o.document ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase">
                      {o.planCode}
                    </td>
                    <td className="px-4 py-3 text-xs">{o._count.stores}</td>
                    <td className="px-4 py-3 text-xs">
                      {o._count.memberships}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          o.status === "active"
                            ? "bg-green-500/20 text-green-300"
                            : "bg-yellow-500/20 text-yellow-300"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/platform/organizations/${o.id}`}
                        className="text-xs text-brand hover:underline"
                      >
                        abrir →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Cadastrar nova empresa</h2>
        <p className="mb-4 text-sm text-muted">
          Criar uma organização cria automaticamente a primeira loja, o
          primeiro usuário (owner), e — se habilitado — provisiona a empresa
          no Chatwoot, GLPI e Evolution.
        </p>
        <CreateOrgForm />
      </section>
    </div>
  );
}
