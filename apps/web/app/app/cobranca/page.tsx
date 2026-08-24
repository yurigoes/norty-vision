import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { DunningClient } from "./DunningClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

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
  if (!session.authenticated) redirect(await loginPath());
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
      <PageHeader
        eyebrow="Configuração · Cobrança"
        title="Régua de cobrança"
        description={<>O sistema cobra automaticamente conforme estas regras (lembretes antes do vencimento e cobranças após). Placeholders:{" "} <code className="rounded bg-line px-1 text-xs">{"{{nome}} {{parcela}} {{valor}} {{vencimento}} {{dias}}"}</code></>}
      />

      <DunningClient initialRules={data?.items ?? []} />
    </div>
  );
}
