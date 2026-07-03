import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { FollowupsClient } from "./FollowupsClient";

export const dynamic = "force-dynamic";

interface Followup {
  id: string;
  kind: string;
  note: string | null;
  status: string;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null; whatsappPhone: string | null };
}

export default async function PendenciasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  const res = await apiFetch<{ items: Followup[] }>("/api/schedule/followups?status=open");

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Agenda</p>
        <h1 className="mt-1 text-3xl font-semibold">Pendências</h1>
        <p className="mt-2 text-muted">
          Clientes que cancelaram (WhatsApp ou portal) e precisam de contato para remarcar.
        </p>
        <a href="/app/agenda/recall-exames" className="mt-3 inline-block rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">
          📅 Recall de exame (1 ano) →
        </a>
      </header>
      <FollowupsClient items={res.data?.items ?? []} />
    </div>
  );
}
