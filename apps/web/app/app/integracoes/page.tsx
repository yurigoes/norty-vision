import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { IntegrationsClient } from "./IntegrationsClient";
import { SupportAccessOrgCard } from "./SupportAccessOrgCard";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function IntegracoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O PORTEIRO DESTA TELA É O `perm` DELA NO `nav.ts` (lib/acesso.ts, aplicado
  // no layout de /app). Aqui havia um segundo porteiro à mão, exigindo
  // isOrgAdmin — e ele VENCIA, porque a página roda depois do layout. O efeito:
  // conceder a permissão fazia o item APARECER no menu e a tela responder
  // "Apenas administradores". Permissão concedida que não abre nada.

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
      <PageHeader
        eyebrow="Configuração · Integrações"
        title="Integrações"
        description="Status do Chatwoot, GLPI e do WhatsApp (Evolution) da sua empresa. Conecte o WhatsApp de cada loja escaneando o QR code."
      />

      <IntegrationsClient initial={status} />
      <SupportAccessOrgCard />
    </div>
  );
}
