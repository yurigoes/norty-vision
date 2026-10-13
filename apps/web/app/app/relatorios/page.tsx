import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ReportsClient } from "./ReportsClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.

  const [summaryRes, collectionsRes] = await Promise.all([
    apiFetch<any>("/api/reports/credit/summary"),
    apiFetch<{ items: any[] }>("/api/reports/collections?limit=100"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Relatórios"
        title={<>Crediário & Cobranças</>}
        description="Situação das parcelas, contas por status e linha do tempo de cobrança."
      />

      <ReportsClient
        summary={summaryRes.data ?? null}
        collections={collectionsRes.data?.items ?? []}
      />
    </div>
  );
}
