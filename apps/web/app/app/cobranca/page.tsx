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
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.

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
