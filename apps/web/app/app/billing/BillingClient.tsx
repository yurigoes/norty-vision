"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";
import { moduleLabel } from "../../../lib/modules";

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

export function BillingClient({
  subscription,
  plans,
}: {
  subscription: SubscriptionWithPlan | null;
  plans: Plan[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null; amountCents: number } | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [offers, setOffers] = useState<Array<{ moduleKey: string; priceCents: number }>>([]);

  useEffect(() => {
    fetch("/api/subscriptions/module-offers", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setOffers(d.items ?? [])).catch(() => {});
  }, []);

  async function buyModule(moduleKey: string, method: "pix" | "card") {
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/module-offers/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ moduleKey, method }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Falha ao gerar cobrança"); return; }
      if (method === "card") { if (data.initPoint) window.location.href = data.initPoint; }
      else { setPix({ qrCode: data.qrCode ?? null, qrCodeBase64: data.qrCodeBase64 ?? null, amountCents: data.amountCents ?? 0 }); }
    } finally { setLoading(false); }
  }

  async function startOneTime(planSlug: string, method: "pix" | "card") {
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/one-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug, method }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Falha ao gerar cobrança"); return; }
      if (method === "card") {
        if (data.initPoint) window.location.href = data.initPoint;
      } else {
        setPix({ qrCode: data.qrCode ?? null, qrCodeBase64: data.qrCodeBase64 ?? null, amountCents: data.amountCents ?? 0 });
      }
    } finally { setLoading(false); }
  }

  async function startCheckout(planSlug: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha ao gerar checkout");
        return;
      }
      if (data.initPoint) {
        window.location.href = data.initPoint;
      } else {
        startTransition(() => router.refresh());
      }
    } finally {
      setLoading(false);
    }
  }

  async function cancelSubscription() {
    if (!(await dialog.confirm({ message: "Cancelar a assinatura? Você ainda tem acesso até o fim do período pago.", confirmLabel: "Cancelar assinatura", tone: "danger" }))) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/cancel", {
        method: "PATCH",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha ao cancelar");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {!subscription ? (
        <section className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-6">
          <h2 className="text-lg font-semibold">Sem assinatura ativa</h2>
          <p className="mt-1 text-sm text-muted">
            Escolha um plano abaixo pra ativar.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">
                Plano atual
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                {subscription.plan.name}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {(subscription.plan.priceCents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: subscription.plan.currency,
                })}
                {subscription.plan.interval === "yearly" ? "/ano" : "/mês"}
              </p>
            </div>
            <StatusBadge status={subscription.status} />
          </div>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            {subscription.trialEndsAt && subscription.status === "trialing" && (
              <Row
                label="Trial termina"
                value={new Date(subscription.trialEndsAt).toLocaleDateString("pt-BR")}
              />
            )}
            {subscription.currentPeriodEnd && (
              <Row
                label="Próximo ciclo"
                value={new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR")}
              />
            )}
            {subscription.endsAt && subscription.status === "canceled" && (
              <Row
                label="Acesso até"
                value={new Date(subscription.endsAt).toLocaleDateString("pt-BR")}
              />
            )}
          </dl>

          {subscription.status === "trialing" && (
            <button
              onClick={() => startCheckout(subscription.plan.slug)}
              disabled={loading || isPending}
              className="btn-grad mt-6 disabled:opacity-50"
            >
              {loading ? "Gerando..." : "Ativar pagamento (Mercado Pago)"}
            </button>
          )}

          {(subscription.status === "active" || subscription.status === "trialing") && (
            <button
              onClick={cancelSubscription}
              disabled={loading || isPending}
              className="ml-3 rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-red-400"
            >
              Cancelar
            </button>
          )}
        </section>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {plans.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            {subscription ? "Trocar plano" : "Escolher plano"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = subscription?.plan.slug === p.slug;
              return (
                <div
                  key={p.id}
                  className="card"
                >
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  <p className="mt-1 text-xs text-muted">{p.description}</p>
                  <p className="mt-3 text-xl font-semibold">
                    {(p.priceCents / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: p.currency,
                    })}
                    <span className="ml-1 text-xs font-normal text-muted">
                      {p.interval === "yearly" ? "/ano" : "/mês"}
                    </span>
                  </p>
                  <button
                    disabled={loading || isPending}
                    onClick={() => startCheckout(p.slug)}
                    className="btn-grad mt-4 w-full py-2 text-xs disabled:opacity-50"
                  >
                    Assinar (recorrente)
                  </button>
                  <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-muted">ou pague 1 {p.interval === "yearly" ? "ano" : "mês"} avulso</p>
                  <div className="mt-1 flex gap-2">
                    <button
                      disabled={loading || isPending}
                      onClick={() => startOneTime(p.slug, "pix")}
                      className="flex-1 rounded-xl border border-line py-2 text-xs font-medium transition hover:border-brand/60 hover:text-brand disabled:opacity-50"
                    >
                      Pix
                    </button>
                    <button
                      disabled={loading || isPending}
                      onClick={() => startOneTime(p.slug, "card")}
                      className="flex-1 rounded-xl border border-line py-2 text-xs font-medium transition hover:border-brand/60 hover:text-brand disabled:opacity-50"
                    >
                      Cartão
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {offers.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Módulos extras (à la carte)</h2>
          <p className="mb-4 text-sm text-muted">Módulos liberados pelo suporte para sua empresa contratar à parte. Após o pagamento, o módulo é desbloqueado automaticamente.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => (
              <div key={o.moduleKey} className="card">
                <h3 className="text-base font-semibold">{moduleLabel(o.moduleKey)}</h3>
                <p className="mt-2 text-xl font-semibold">
                  {(o.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
                <div className="mt-3 flex gap-2">
                  <button disabled={loading || isPending} onClick={() => buyModule(o.moduleKey, "pix")} className="flex-1 rounded-xl border border-line py-2 text-xs font-medium transition hover:border-brand/60 hover:text-brand disabled:opacity-50">Pix</button>
                  <button disabled={loading || isPending} onClick={() => buyModule(o.moduleKey, "card")} className="flex-1 rounded-xl border border-line py-2 text-xs font-medium transition hover:border-brand/60 hover:text-brand disabled:opacity-50">Cartão</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {pix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setPix(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Pix da assinatura</h3>
            <p className="mt-1 text-sm text-muted">
              {(pix.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — a assinatura ativa automaticamente após o pagamento.
            </p>
            {pix.qrCodeBase64 ? (
              <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Pix" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" />
            ) : (
              <p className="mt-4 text-xs text-muted">QR indisponível — use o copia e cola.</p>
            )}
            {pix.qrCode && (
              <button
                onClick={() => { navigator.clipboard?.writeText(pix.qrCode!).then(() => { setPixCopied(true); setTimeout(() => setPixCopied(false), 2000); }); }}
                className="mt-4 w-full break-all rounded-xl border border-line bg-surface-2 px-3 py-2 text-[11px] text-muted transition hover:border-brand"
              >
                {pixCopied ? "✓ copiado!" : pix.qrCode}
              </button>
            )}
            <button onClick={() => { setPix(null); startTransition(() => router.refresh()); }} className="btn-grad mt-3 w-full py-2 text-sm">
              Já paguei / Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    trialing: "bg-blue-500/20 text-blue-300",
    active: "bg-green-500/20 text-green-300",
    past_due: "bg-yellow-500/20 text-yellow-300",
    canceled: "bg-red-500/20 text-red-300",
    paused: "bg-line text-muted",
  };
  const label: Record<string, string> = {
    trialing: "em trial",
    active: "ativa",
    past_due: "pagamento pendente",
    canceled: "cancelada",
    paused: "pausada",
  };
  return (
    <span
      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase ${
        styles[status] ?? "bg-line text-muted"
      }`}
    >
      {label[status] ?? status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
