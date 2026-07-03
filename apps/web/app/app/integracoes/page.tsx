import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { IntegrationsClient } from "./IntegrationsClient";
import { SupportAccessOrgCard } from "./SupportAccessOrgCard";

export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem ver as integrações.
        </p>
      </div>
    );
  }

  const res = await apiFetch<any>("/api/company-integrations");
  const d = res.ok ? res.data : null;
  const status = {
    chatwoot: { provisioned: !!d?.chatwoot?.provisioned },
    glpi: { provisioned: !!d?.glpi?.provisioned },
    evolution: {
      instanceName: d?.evolution?.instanceName ?? null,
      status: d?.evolution?.status ?? null,
    },
  };

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Integrações
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Integrações</h1>
        <p className="mt-2 text-muted">
          Status do Chatwoot, GLPI e do WhatsApp (Evolution) da sua empresa.
          Conecte o WhatsApp de cada loja escaneando o QR code.
        </p>
      </header>

      <IntegrationsClient initial={status} />
      <SupportAccessOrgCard />
    </div>
  );
}
