import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { WebhooksClient } from "./WebhooksClient";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";
import { PRODUCT_NAME } from "../../../../lib/brand";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!can(session, "integrations.manage")) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Sem permissão para gerenciar webhooks (precisa de <code>integrations.manage</code>).
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Atendimento"
        title="Webhooks (out)"
        description={<>O {PRODUCT_NAME} dispara <code>POST</code> JSON pra uma URL externa quando eventos do atendimento acontecem. Use n8n, Zapier ou qualquer endpoint próprio pra criar automações (avisar Slack, salvar em Google Sheets, abrir ticket no Jira, etc).</>}
      />
      <WebhooksClient />
    </div>
  );
}
