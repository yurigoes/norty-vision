import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { CostureirasClient } from "./CostureirasClient";

export const dynamic = "force-dynamic";

export default async function CostureirasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!can(session, "payouts.manage") && !can(session, "production.assign")) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Sem permissão para gerenciar costureiras (precisa de <code>payouts.manage</code> ou <code>production.assign</code>).
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Produção</p>
        <h1 className="mt-1 text-3xl font-semibold">Costureiras</h1>
        <p className="mt-2 text-muted">
          Atribua pedidos para uma costureira, acompanhe o que ela produziu no período e pague — com upload de comprovante.
        </p>
      </header>
      <CostureirasClient />
    </div>
  );
}
