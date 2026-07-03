import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { moduleLabel, planLimitLines } from "../../lib/modules";

export const dynamic = "force-dynamic";

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlight: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  trialDays: number;
  maxStores: number | null;
  maxUsers: number | null;
  maxMessagesMonth: number | null;
  features: string[];
  extraHighlights?: string[];
  isActive: boolean;
  displayOrder: number;
}

export default async function PlanosPage() {
  const { data } = await apiFetch<{ items: Plan[] }>("/api/plans");
  const plans = data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">
          Planos
        </p>
        <h1 className="text-gradient-brand mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Escolha o plano certo pra sua operação
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          Todos os planos incluem <strong>14 dias grátis</strong>. Sem cartão de
          crédito no cadastro. Cancele quando quiser.
        </p>
      </header>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </div>

      <footer className="mt-16 text-center text-sm text-muted">
        <p>
          Precisa de algo customizado?{" "}
          <a href="mailto:contato@yugochat.com.br" className="text-brand hover:underline">
            Fala com a gente
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const isHighlight = !!plan.highlight;
  const price = (plan.priceCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: plan.currency,
  });
  const intervalLabel = plan.interval === "yearly" ? "/ano" : "/mês";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-surface p-6 shadow-[var(--shadow-sm)] transition duration-300 hover:-translate-y-1 ${
        isHighlight
          ? "border-brand/60 shadow-[var(--shadow-lg)] ring-1 ring-brand/15"
          : "border-line hover:border-brand/50"
      }`}
    >
      {isHighlight && (
        <div className="btn-grad absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] uppercase tracking-wider">
          {plan.highlight}
        </div>
      )}
      <h3 className="text-xl font-semibold">{plan.name}</h3>
      {plan.description && (
        <p className="mt-1 text-sm text-muted">{plan.description}</p>
      )}
      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-semibold">{price}</span>
        <span className="text-sm text-muted">{intervalLabel}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {plan.trialDays} dias grátis pra testar
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        {planLimitLines(plan).map((l) => (
          <li key={l} className="flex items-start gap-2 text-muted">
            <span className="mt-0.5">•</span>
            <span>{l}</span>
          </li>
        ))}
        {plan.features.map((k) => (
          <li key={k} className="flex items-start gap-2">
            <span className="mt-0.5 text-brand">✓</span>
            <span>{moduleLabel(k)}</span>
          </li>
        ))}
        {(plan.extraHighlights ?? []).map((h, i) => (
          <li key={`h${i}`} className="flex items-start gap-2">
            <span className="mt-0.5 text-brand">★</span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/signup?plan=${plan.slug}`}
        className={`mt-8 block rounded-xl py-3 text-center text-sm font-semibold transition ${
          isHighlight
            ? "btn-grad"
            : "border border-line text-fg hover:border-brand/60"
        }`}
      >
        Começar grátis
      </Link>
    </div>
  );
}
