import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { DunningClient } from "./DunningClient";

export const dynamic = "force-dynamic";

interface Rule {
  id: string;
  name: string;
  daysAfterDue: number;
  channel: string;
  templateText: string;
  isActive: boolean;
}

export default async function CobrancaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem configurar a cobrança.
        </p>
      </div>
    );
  }

  const { data } = await apiFetch<{ items: Rule[] }>("/api/dunning/rules");

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Cobrança
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Régua de cobrança</h1>
        <p className="mt-2 text-muted">
          O sistema cobra automaticamente conforme estas regras (lembretes
          antes do vencimento e cobranças após). Placeholders:{" "}
          <code className="rounded bg-line px-1 text-xs">{"{{nome}} {{parcela}} {{valor}} {{vencimento}} {{dias}}"}</code>
        </p>
      </header>

      <DunningClient initialRules={data?.items ?? []} />
    </div>
  );
}
