import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { PlansAdminClient } from "./PlansAdminClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlight: string | null;
  niche: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  trialDays: number;
  maxStores: number | null;
  maxUsers: number | null;
  maxMessagesMonth: number | null;
  features: string[];
  isActive: boolean;
  displayOrder: number;
  mpPlanId: string | null;
}

export default async function PlatformPlansPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const { data } = await apiFetch<{ items: Plan[] }>("/api/plans/admin/all");

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Master · Planos"
        title="Catálogo de planos"
        description="Configure os planos que aparecem na landing e no signup. Inclui preço, trial, limites e features."
      />

      <PlansAdminClient initialPlans={data?.items ?? []} />
    </div>
  );
}
