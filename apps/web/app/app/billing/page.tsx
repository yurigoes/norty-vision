import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { BillingClient } from "./BillingClient";
import { Mensalidades } from "./Mensalidades";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

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
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
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
      <PageHeader
        eyebrow="Configuração · Billing"
        title="Assinatura"
        description="Plano ativo, status do pagamento e troca de plano."
      />

      <BillingClient
        subscription={subRes.data?.subscription ?? null}
        plans={plansRes.data?.items ?? []}
      />

      <Mensalidades />
    </div>
  );
}
