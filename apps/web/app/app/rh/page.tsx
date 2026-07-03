import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { RhClient } from "./RhClient";

export const dynamic = "force-dynamic";

export default async function RhPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Pessoas</p>
        <h1 className="mt-1 text-3xl font-semibold">RH & Funcionários</h1>
        <p className="mt-2 text-muted">
          Ficha dos funcionários, holerite, ponto eletrônico, solicitações
          (férias, vale, troca de horário), escala e mural de avisos.
        </p>
      </header>

      <RhClient
        initialEmployees={empRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
      />
    </div>
  );
}
