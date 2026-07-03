import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { PayoutsClient } from "./PayoutsClient";

export const dynamic = "force-dynamic";

export default async function RepassesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="card p-6 text-muted">
          Apenas administradores podem ver os repasses.
        </p>
      </div>
    );
  }

  const [supRes, setRes, profitRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/payouts/settlements"),
    apiFetch<any>("/api/payouts/profit"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Ótica · Financeiro</p>
        <h1 className="mt-1 text-3xl font-semibold">Repasses</h1>
        <p className="mt-2 text-muted">
          Feche o que é devido a médicos (repasse por exame) e laboratórios
          (custo da lente), registre o pagamento e gere o recibo. Veja o lucro real.
        </p>
      </header>

      <PayoutsClient
        suppliers={supRes.data?.items ?? []}
        settlements={setRes.data?.items ?? []}
        profit={profitRes.data ?? { rows: [], totals: { revenueCents: 0, labCostCents: 0, doctorPayoutCents: 0, profitCents: 0 } }}
      />
    </div>
  );
}
