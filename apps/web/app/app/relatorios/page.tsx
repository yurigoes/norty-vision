import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ReportsClient } from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem ver relatórios.
        </p>
      </div>
    );
  }

  const [summaryRes, collectionsRes] = await Promise.all([
    apiFetch<any>("/api/reports/credit/summary"),
    apiFetch<{ items: any[] }>("/api/reports/collections?limit=100"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Relatórios
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Crediário & Cobranças</h1>
        <p className="mt-2 text-muted">
          Situação das parcelas, contas por status e linha do tempo de cobrança.
        </p>
      </header>

      <ReportsClient
        summary={summaryRes.data ?? null}
        collections={collectionsRes.data?.items ?? []}
      />
    </div>
  );
}
