import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { WebhooksClient } from "./WebhooksClient";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
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
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
        <h1 className="mt-1 text-3xl font-semibold">Webhooks (out)</h1>
        <p className="mt-2 text-muted">
          O Yugo dispara <code>POST</code> JSON pra uma URL externa quando eventos do atendimento
          acontecem. Use n8n, Zapier ou qualquer endpoint próprio pra criar automações
          (avisar Slack, salvar em Google Sheets, abrir ticket no Jira, etc).
        </p>
      </header>
      <WebhooksClient />
    </div>
  );
}
