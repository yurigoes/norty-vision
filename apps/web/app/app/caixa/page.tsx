import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { CaixaClient } from "./CaixaClient";

export const dynamic = "force-dynamic";

interface Store { id: string; name: string }

export default async function CaixaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  const storesRes = await apiFetch<{ items: Store[] }>("/api/stores");

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">PDV</p>
        <h1 className="mt-1 text-3xl font-semibold">Caixa diário</h1>
        <p className="mt-2 text-muted">Abra o caixa no início do dia e feche conferindo os totais por meio de pagamento.</p>
      </header>
      <CaixaClient stores={storesRes.data?.items ?? []} />
    </div>
  );
}
