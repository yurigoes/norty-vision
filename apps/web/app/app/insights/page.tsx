import { InsightsClient } from "./InsightsClient";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">IA · Operação</p>
        <h1 className="mt-1 text-3xl font-semibold">Insights & Gargalos</h1>
        <p className="mt-2 text-muted">
          A IA analisa sua operação e aponta onde está o gargalo (produção parada, parcelas vencidas,
          estoque baixo, atendimento sem resposta). A detecção é por regras; a IA resume.
        </p>
      </header>
      <InsightsClient />
    </div>
  );
}
