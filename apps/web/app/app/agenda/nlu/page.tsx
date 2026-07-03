import { apiFetch } from "../../../../lib/api";
import { NluClient } from "./NluClient";

export const dynamic = "force-dynamic";

interface UnresolvedItem {
  id: string;
  rawText: string;
  candidates: Array<{ intent: string; score: number }>;
  status: string;
  createdAt: string;
}

interface Keyword {
  id: string;
  organizationId: string | null;
  storeId: string | null;
  intent: string;
  keyword: string;
  matchType: string;
  weight: number;
  isActive: boolean;
  source: string;
}

export default async function NluPage() {
  const [unresRes, kwRes] = await Promise.all([
    apiFetch<{ items: UnresolvedItem[] }>("/api/nlu/unresolved"),
    apiFetch<{ items: Keyword[] }>("/api/nlu/keywords"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Agenda · NLU
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Revisão de respostas</h1>
        <p className="mt-2 text-muted">
          Quando o sistema não classifica uma resposta com confiança, ela
          aparece aqui pra você decidir. Ao resolver, dá pra promover a
          palavra como nova regra automática.
        </p>
      </header>

      <NluClient
        initialUnresolved={unresRes.data?.items ?? []}
        initialKeywords={kwRes.data?.items ?? []}
      />
    </div>
  );
}
