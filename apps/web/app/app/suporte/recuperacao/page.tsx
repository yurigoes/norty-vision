import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { RunbookGate } from "./RunbookGate";

export const dynamic = "force-dynamic";

export default async function RecuperacaoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  // restrito ao master (platform user); empresas não veem
  if (!session.master) redirect("/app/suporte");

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Master
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Recuperação &amp; Backup</h1>
        <p className="mt-2 text-muted">
          Runbook completo: reerguer a plataforma numa VPS nova, restaurar backup
          e configurar o backup automático no Google Drive. Protegido por senha.
        </p>
      </header>

      <RunbookGate />
    </div>
  );
}
