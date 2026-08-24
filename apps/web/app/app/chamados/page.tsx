import { ChamadosClient } from "./ChamadosClient";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default function ChamadosPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Suporte"
        title="Chamados"
        description="Helpdesk e ordens de serviço — atendimento, SLA e acompanhamento."
      />
      <ChamadosClient />
    </div>
  );
}
