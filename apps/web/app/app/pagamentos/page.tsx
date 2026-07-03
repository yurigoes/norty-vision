import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { PaymentsConfigClient } from "./PaymentsConfigClient";
import { InfinitepayConfigClient } from "./InfinitepayConfigClient";

export const dynamic = "force-dynamic";

interface MpIntegration {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  hasToken: boolean;
  hasWebhookSecret: boolean;
  publicKey: string | null;
  lastPingAt: string | null;
  lastPingStatus: string | null;
}

export default async function PagamentosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem configurar pagamentos.
        </p>
      </div>
    );
  }

  const orgId = session.user?.orgId ?? "";
  const [{ data }, { data: ipData }] = await Promise.all([
    apiFetch<{ integration: MpIntegration | null }>("/api/org-integrations/mercadopago"),
    apiFetch<{ integration: any | null }>("/api/org-integrations/infinitepay"),
  ]);

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Pagamentos
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Mercado Pago da empresa</h1>
        <p className="mt-2 text-muted">
          Conecte a conta Mercado Pago <strong>da sua empresa</strong> para
          cobrar clientes do crediário (Pix, cartão à vista e recorrente). É
          separado da assinatura da plataforma.
        </p>
      </header>

      <PaymentsConfigClient initial={data?.integration ?? null} orgId={orgId} />

      <div className="mt-8">
        <InfinitepayConfigClient initial={ipData?.integration ?? null} />
      </div>
    </div>
  );
}
