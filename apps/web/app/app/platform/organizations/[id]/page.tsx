import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../../lib/session";
import { apiFetch } from "../../../../../lib/api";
import { OrgEditForm } from "./OrgEditForm";
import { OrgUserResetButton } from "./OrgUserResetButton";
import { OrgUserUnblockButton } from "./OrgUserUnblockButton";
import { OrgProvisionButton } from "./OrgProvisionButton";
import { OrgImpersonateButton } from "./OrgImpersonateButton";
import { OrgModulesCard } from "./OrgModulesCard";
import { ModuleFeaturesCard } from "./ModuleFeaturesCard";
import { OrgSupportAccessCard } from "./OrgSupportAccessCard";

export const dynamic = "force-dynamic";

interface OrgDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  document: string | null;
  documentType: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  planCode: string;
  primaryColor: string | null;
  logoUrl: string | null;
  productSkin: string | null;
  evolutionStatus: string | null;
  chatwootAccountId: string | null;
  glpiEntityId: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  stores: Array<{
    id: string;
    slug: string;
    name: string;
    city: string | null;
    state: string | null;
    status: string;
  }>;
  _count: { stores: number; memberships: number };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  lastLoginAt: string | null;
  memberships: Array<{
    id: string;
    status: string;
    isPrimary: boolean;
    store: { id: string; slug: string; name: string } | null;
    role: { slug: string; name: string };
  }>;
}

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const { id } = await params;
  const [orgRes, usersRes] = await Promise.all([
    apiFetch<{ organization: OrgDetail | null }>(`/api/organizations/${id}`),
    apiFetch<{ items: UserRow[] }>(
      `/api/users?organizationId=${encodeURIComponent(id)}`,
    ),
  ]);
  const org = orgRes.data?.organization;
  const users = usersRes.data?.items ?? [];

  if (!org) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/app/platform/organizations"
          className="text-sm text-brand hover:underline"
        >
          ← voltar
        </Link>
        <p className="mt-8 rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Organização não encontrada.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <Link
          href="/app/platform/organizations"
          className="text-sm text-brand hover:underline"
        >
          ← Organizações
        </Link>
        <header className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
            Master · {org.slug}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{org.name}</h1>
          {org.legalName && (
            <p className="mt-1 text-sm text-muted">{org.legalName}</p>
          )}
        </header>
      </div>

      <section className="rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Identificação</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="ID" value={org.id} mono />
          <Row label="Slug" value={org.slug} mono />
          <Row label="Plano" value={org.planCode} />
          <Row label="Status" value={org.status} />
          <Row
            label="Documento"
            value={
              org.document
                ? `${org.document} (${org.documentType ?? "?"})`
                : "—"
            }
          />
          <Row label="Contato" value={org.contactEmail ?? "—"} />
          <Row label="Telefone" value={org.contactPhone ?? "—"} />
          <Row
            label="Trial"
            value={
              org.trialEndsAt
                ? new Date(org.trialEndsAt).toLocaleDateString("pt-BR")
                : "—"
            }
          />
          <Row
            label="Criada em"
            value={new Date(org.createdAt).toLocaleString("pt-BR")}
          />
        </div>
      </section>

      {/* edição completa (master) */}
      <OrgEditForm org={org} />

      {/* status das integrações */}
      <section className="rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Integrações</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <IntegStatus
            label="WhatsApp (Evolution)"
            ok={org.evolutionStatus === "connected"}
            text={org.evolutionStatus ?? "não conectado"}
          />
          <IntegStatus
            label="Chatwoot"
            ok={!!org.chatwootAccountId}
            text={org.chatwootAccountId ? `conta ${org.chatwootAccountId}` : "não aprovisionado"}
          />
          <IntegStatus
            label="GLPI"
            ok={!!org.glpiEntityId}
            text={org.glpiEntityId ? `entidade ${org.glpiEntityId}` : "não aprovisionado"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <OrgProvisionButton orgId={org.id} />
          <OrgImpersonateButton orgId={org.id} orgName={org.name} />
        </div>
        <p className="mt-2 text-xs text-muted">
          Provisiona a empresa nos sistemas configurados no master. Use se aparecer "não aprovisionado".
          "Entrar como esta empresa" abre o painel dela em modo master (com registro).
        </p>
      </section>

      <OrgModulesCard orgId={org.id} />

      <ModuleFeaturesCard orgId={org.id} />

      <OrgSupportAccessCard orgId={org.id} />

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Lojas ({org.stores.length})
          </h2>
        </div>
        {org.stores.length === 0 ? (
          <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
            Nenhuma loja.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Cidade/UF</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {org.stores.map((s) => (
                  <tr key={s.id} className="border-t border-line/50">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {s.slug}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {[s.city, s.state].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Usuários ({users.length})
        </h2>
        {users.length === 0 ? (
          <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
            Nenhum usuário.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Papel/Loja</th>
                  <th className="px-4 py-3">Último acesso</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line/50 align-top">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {u.email}
                    </td>
                    <td className="px-4 py-3">
                      {u.memberships.map((m) => (
                        <div key={m.id} className="text-xs">
                          <span className="font-semibold">{m.role.name}</span>
                          {m.store && (
                            <span className="text-muted"> · {m.store.name}</span>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <OrgUserResetButton userId={u.id} userName={u.name} />
                        <OrgUserUnblockButton userId={u.id} userName={u.name} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function IntegStatus({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${ok ? "text-green-600 dark:text-green-300" : "text-orange-500 dark:text-orange-300"}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-orange-400"}`} />
        {text}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className={mono ? "mt-0.5 font-mono text-xs" : "mt-0.5"}>{value}</dd>
    </div>
  );
}
