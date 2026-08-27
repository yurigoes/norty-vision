import { getSession } from "../../../../lib/session";
import { SistemaClient } from "./SistemaClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SistemaPage() {
  const session = await getSession();
  if (!session.master) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          eyebrow="Suporte · Sistema"
          title="Acesso restrito"
        />
        <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
          Operações de servidor (RAM, disco, backup, manutenção) são exclusivas do master da plataforma.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Sistema"
        title="Servidor / VPS"
        description="Uso de RAM e disco, backup do banco e rotinas de manutenção do servidor."
      />
      <SistemaClient />
    </div>
  );
}
