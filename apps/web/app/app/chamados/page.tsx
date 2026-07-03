import { ChamadosClient } from "./ChamadosClient";

export const dynamic = "force-dynamic";

export default function ChamadosPage() {
  return (
    <div className="max-w-6xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Suporte</p>
        <h1 className="mt-1 text-3xl font-semibold">Chamados</h1>
        <p className="mt-2 text-muted">Helpdesk e ordens de serviço — atendimento, SLA e acompanhamento.</p>
      </header>
      <ChamadosClient />
    </div>
  );
}
