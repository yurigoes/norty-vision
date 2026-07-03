import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { PlatformContractsClient } from "./PlatformContractsClient";

export const dynamic = "force-dynamic";

export default async function PlatformContratosPage() {
  const session = await getSession();
  if (!session.master || session.master.platformRole === "support") redirect("/app");

  const [tplRes, contractsRes, orgsRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/platform/contract-templates"),
    apiFetch<{ items: any[] }>("/api/platform/contracts"),
    apiFetch<{ items: any[] }>("/api/organizations"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master</p>
        <h1 className="mt-1 text-3xl font-semibold">Contratos com empresas</h1>
        <p className="mt-2 text-muted">
          Modelos de contrato (onboarding, aditivos, serviço extra), envio para as
          empresas e acompanhamento dos aceites (clickwrap com IP + hash).
        </p>
      </header>

      <PlatformContractsClient
        initialTemplates={tplRes.data?.items ?? []}
        initialContracts={contractsRes.data?.items ?? []}
        orgs={(orgsRes.data?.items ?? []).map((o: any) => ({ id: o.id, name: o.name }))}
      />
    </div>
  );
}
