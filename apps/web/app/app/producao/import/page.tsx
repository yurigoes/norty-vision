import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ProducaoImportPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!can(session, "production.create")) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Sem permissão para importar pedidos (precisa de <code>production.create</code>).
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Produção</p>
        <h1 className="mt-1 text-3xl font-semibold">Importar planilha</h1>
        <p className="mt-2 text-muted">
          Suba o .xlsx legado (VR Sports, por exemplo). O sistema detecta o
          cabeçalho, monta os pedidos com clientes + costureiras e pula linhas
          já importadas. Recomendado: <strong>visualizar antes</strong> pra ver
          como vai ficar.
        </p>
      </header>
      <ImportClient />
    </div>
  );
}
