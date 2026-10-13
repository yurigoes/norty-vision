import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { MessagingClient } from "./MessagingClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ModelosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.

  const [tplRes, smtpRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/messaging/templates"),
    apiFetch<{ smtp: any }>("/api/messaging/smtp"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuração · Mensagens"
        title="Modelos de mensagem"
        description="Crie modelos de email e WhatsApp com variáveis, teste o envio e configure o SMTP da sua empresa."
      />

      <MessagingClient
        initialTemplates={tplRes.data?.items ?? []}
        initialSmtp={smtpRes.data?.smtp ?? null}
      />
    </div>
  );
}
