import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { PlansAdminClient } from "./PlansAdminClient";

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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Master · Planos
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Catálogo de planos</h1>
        <p className="mt-2 text-muted">
          Configure os planos que aparecem na landing e no signup. Inclui
          preço, trial, limites e features.
        </p>
      </header>

      <PlansAdminClient initialPlans={data?.items ?? []} />
    </div>
  );
}
