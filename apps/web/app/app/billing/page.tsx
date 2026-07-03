import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { BillingClient } from "./BillingClient";
import { Mensalidades } from "./Mensalidades";

export const dynamic = "force-dynamic";

interface SubscriptionWithPlan {
  id: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  mpInitPoint: string | null;
  endsAt: string | null;
  plan: {
    id: string;
    slug: string;
    name: string;
    priceCents: number;
    currency: string;
    interval: string;
    features: string[];
  };
}

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  features: string[];
}

export default async function BillingPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem ver o billing da empresa.
        </p>
      </div>
    );
  }

  const [subRes, plansRes] = await Promise.all([
    apiFetch<{ subscription: SubscriptionWithPlan | null }>(
      "/api/subscriptions/current",
    ),
    apiFetch<{ items: Plan[] }>("/api/plans/for-org"),
  ]);

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Billing
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Assinatura</h1>
        <p className="mt-2 text-muted">
          Plano ativo, status do pagamento e troca de plano.
        </p>
      </header>

      <BillingClient
        subscription={subRes.data?.subscription ?? null}
        plans={plansRes.data?.items ?? []}
      />

      <Mensalidades />
    </div>
  );
}
