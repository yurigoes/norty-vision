import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { CostureirasClient } from "./CostureirasClient";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CostureirasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
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
      <PageHeader
        eyebrow="Produção"
        title="Costureiras"
        description="Atribua pedidos para uma costureira, acompanhe o que ela produziu no período e pague — com upload de comprovante."
      />
      <CostureirasClient />
    </div>
  );
}
