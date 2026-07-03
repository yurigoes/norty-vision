import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { TeamClient } from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function PlatformTeamPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.master || session.master.platformRole === "support") {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas o dono do SaaS pode gerenciar a equipe master.
        </p>
      </div>
    );
  }

  const res = await apiFetch<{ items: any[] }>("/api/platform/team");

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Master · Equipe
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Equipe master</h1>
        <p className="mt-2 text-muted">
          O <strong>dono</strong> tem acesso total. O <strong>suporte master</strong>{" "}
          opera qualquer empresa, mas não acessa a configuração do SaaS
          (identidade, planos, integrações e cofre de credenciais).
        </p>
      </header>

      <TeamClient
        initial={res.data?.items ?? []}
        selfId={session.master.id}
      />
    </div>
  );
}
