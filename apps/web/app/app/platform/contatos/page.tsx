import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { ContatosClient } from "./ContatosClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ContatosPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const res = await apiFetch<{ items: any[] }>("/api/platform/contacts");

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Master"
        title="Leads do site"
        description="Contatos enviados pelo formulário da landing. Acompanhe o funil: novo → em contato → ganho/perdido."
      />
      <ContatosClient initial={res.data?.items ?? []} />
    </div>
  );
}
