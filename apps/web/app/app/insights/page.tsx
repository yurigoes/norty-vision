import { InsightsClient } from "./InsightsClient";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="IA · Operação"
        title={<>Insights & Gargalos</>}
        description="A IA analisa sua operação e aponta onde está o gargalo (produção parada, parcelas vencidas, estoque baixo, atendimento sem resposta). A detecção é por regras; a IA resume."
      />
      <InsightsClient />
    </div>
  );
}
