import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { PayoutsClient } from "./PayoutsClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RepassesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.

  const [supRes, setRes, profitRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/payouts/settlements"),
    apiFetch<any>("/api/payouts/profit"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Ótica · Financeiro"
        title="Repasses"
        description="Feche o que é devido a médicos (repasse por exame) e laboratórios (custo da lente), registre o pagamento e gere o recibo. Veja o lucro real."
      />

      <PayoutsClient
        suppliers={supRes.data?.items ?? []}
        settlements={setRes.data?.items ?? []}
        profit={profitRes.data ?? { rows: [], totals: { revenueCents: 0, labCostCents: 0, doctorPayoutCents: 0, profitCents: 0 } }}
      />
    </div>
  );
}
