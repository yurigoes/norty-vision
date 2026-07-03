import { ChamadosClient } from "./ChamadosClient";

export const dynamic = "force-dynamic";

export default function ChamadosPage() {
  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Chamados</h1>
        <p className="mt-1 text-muted">Helpdesk e ordens de serviço — atendimento, SLA e acompanhamento.</p>
      </header>
      <ChamadosClient />
    </div>
  );
}
