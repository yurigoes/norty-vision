import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  trialDays: number;
  features: string[];
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planSlug } = await searchParams;
  const { data } = await apiFetch<{ items: Plan[] }>("/api/plans");
  const plans = data?.items ?? [];
  const selected =
    plans.find((p) => p.slug === planSlug) ??
    plans.find((p) => p.slug === "pro") ??
    plans[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8">
        <Link
          href="/planos"
          className="text-sm text-brand hover:underline"
        >
          ← outros planos
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Crie sua conta</h1>
        <p className="mt-1 text-muted">
          {selected
            ? `Começando com o plano ${selected.name} — ${selected.trialDays} dias grátis.`
            : "Selecione um plano em /planos pra começar."}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <SignupForm plans={plans} initialPlanSlug={selected?.slug} />

        {selected && (
          <aside className="glass sticky top-8 h-fit rounded-2xl p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Seu plano
            </h3>
            <p className="mt-2 text-xl font-semibold">{selected.name}</p>
            <p className="mt-1 text-sm text-muted">{selected.description}</p>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">
                {(selected.priceCents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: selected.currency,
                })}
              </span>
              <span className="text-sm text-muted">
                {selected.interval === "yearly" ? "/ano" : "/mês"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Você só será cobrado após o trial.
            </p>
            <ul className="mt-4 space-y-1.5 text-xs">
              {selected.features.slice(0, 6).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-muted">
                  <span className="mt-0.5 text-brand">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
