import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { RunbookGate } from "./RunbookGate";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RecuperacaoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // restrito ao master (platform user); empresas não veem
  if (!session.master) redirect("/app/suporte");

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Master"
        title={<>Recuperação &amp; Backup</>}
        description="Runbook completo: reerguer a plataforma numa VPS nova, restaurar backup e configurar o backup automático no Google Drive. Protegido por senha."
      />

      <RunbookGate />
    </div>
  );
}
