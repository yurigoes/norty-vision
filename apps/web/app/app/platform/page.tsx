import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PlatformDashboard() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const orgsRes = await apiFetch<{ items: Array<{ status: string; planCode: string }> }>("/api/organizations");
  const orgs = orgsRes.data?.items ?? [];
  const total = orgs.length;
  const active = orgs.filter((o) => o.status === "active").length;
  const trial = orgs.filter((o) => o.status === "trialing" || o.planCode === "trial").length;
  const suspended = orgs.filter((o) => o.status === "suspended" || o.status === "canceled").length;

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Master
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Painel da plataforma</h1>
        <p className="mt-2 text-muted">
          Você está logado como dono do yugo-platform. Aqui ficam controles
          que afetam todas as organizações.
        </p>
      </header>

      {/* métricas rápidas */}
      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        <Metric label="Empresas" value={String(total)} />
        <Metric label="Ativas" value={String(active)} tone="green" />
        <Metric label="Em trial" value={String(trial)} tone="orange" />
        <Metric label="Suspensas/Canc." value={String(suspended)} tone="red" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          title="Identidade & Branding"
          body="Logo, CNPJ, endereço, cores, textos legais, redes sociais. Upload direto pro MinIO."
          href="/app/platform/settings"
        />
        <Card
          title="Integrações"
          body="Evolution (WhatsApp), Chatwoot (atendimento), GLPI (helpdesk). Conectar serviços externos."
          href="/app/platform/integrations"
        />
        <Card
          title="🔒 Credenciais"
          body="Cofre com URL/usuário/senha de todos os sistemas integrados. Protegido por senha mestra."
          href="/app/platform/credentials"
        />
        <Card
          title="Acessos às Specs"
          body="Liberar visualização da aba Specs Técnicas para usuários específicos."
          href="/app/platform/grants"
        />
        <Card
          title="Organizações"
          body="Listar e gerenciar todas as orgs cadastradas na plataforma."
          href="/app/platform/organizations"
        />
        <Card
          title="Auditoria"
          body="Logs de ações sensíveis. Append-only, particionado por mês."
          href="/app/platform/audit"
        />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "orange" | "red" }) {
  const color = tone === "green" ? "text-green-600 dark:text-green-300"
    : tone === "orange" ? "text-orange-500 dark:text-orange-300"
    : tone === "red" ? "text-red-500 dark:text-red-300" : "";
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Card({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-line p-5 transition hover:border-brand/60"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </Link>
  );
}
