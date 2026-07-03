import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { ContatosClient } from "./ContatosClient";

export const dynamic = "force-dynamic";

export default async function ContatosPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const res = await apiFetch<{ items: any[] }>("/api/platform/contacts");

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master</p>
        <h1 className="mt-1 text-3xl font-semibold">Leads do site</h1>
        <p className="mt-2 text-muted">Contatos enviados pelo formulário da landing. Acompanhe o funil: novo → em contato → ganho/perdido.</p>
      </header>
      <ContatosClient initial={res.data?.items ?? []} />
    </div>
  );
}
