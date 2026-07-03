import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { MessagingClient } from "./MessagingClient";

export const dynamic = "force-dynamic";

export default async function ModelosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem gerenciar
          modelos de mensagem.
        </p>
      </div>
    );
  }

  const [tplRes, smtpRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/messaging/templates"),
    apiFetch<{ smtp: any }>("/api/messaging/smtp"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Mensagens
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Modelos de mensagem</h1>
        <p className="mt-2 text-muted">
          Crie modelos de email e WhatsApp com variáveis, teste o envio e
          configure o SMTP da sua empresa.
        </p>
      </header>

      <MessagingClient
        initialTemplates={tplRes.data?.items ?? []}
        initialSmtp={smtpRes.data?.smtp ?? null}
      />
    </div>
  );
}
