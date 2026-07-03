import { getSession } from "../../../../lib/session";
import { SistemaClient } from "./SistemaClient";

export const dynamic = "force-dynamic";

export default async function SistemaPage() {
  const session = await getSession();
  if (!session.master) {
    return (
      <div className="max-w-3xl">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Suporte · Sistema</p>
          <h1 className="mt-1 text-3xl font-semibold">Acesso restrito</h1>
        </header>
        <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
          Operações de servidor (RAM, disco, backup, manutenção) são exclusivas do master da plataforma.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Suporte · Sistema</p>
        <h1 className="mt-1 text-3xl font-semibold">Servidor / VPS</h1>
        <p className="mt-2 text-muted">Uso de RAM e disco, backup do banco e rotinas de manutenção do servidor.</p>
      </header>
      <SistemaClient />
    </div>
  );
}
