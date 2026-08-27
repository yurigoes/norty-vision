import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "../../../../lib/session";
import { IntegrationsList } from "./IntegrationsList";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";

  const res = await fetch(`${apiBase}/api/platform/integrations`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  const data = (await res.json()) as {
    integrations?: Array<Record<string, unknown>>;
  };
  const integrations = data.integrations ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Master · Integrações"
        title="Conectar serviços externos"
        description={<>Evolution (WhatsApp), Chatwoot (atendimento) e GLPI (helpdesk interno). Configurações ficam em <code className="font-mono text-xs">platform_integrations</code>.</>}
      />

      <IntegrationsList initial={integrations} />
    </div>
  );
}
