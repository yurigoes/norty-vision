import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { RhClient } from "./RhClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RhPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores podem gerenciar o RH.
        </p>
      </div>
    );
  }

  const [empRes, storesRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/hr/employees"),
    apiFetch<{ items: any[] }>("/api/stores"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Pessoas"
        title={<>RH & Funcionários</>}
        description="Ficha dos funcionários, holerite, ponto eletrônico, solicitações (férias, vale, troca de horário), escala e mural de avisos."
      />

      <RhClient
        initialEmployees={empRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
      />
    </div>
  );
}
