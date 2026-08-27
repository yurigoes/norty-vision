import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { TransacoesClient, type Tx } from "./TransacoesClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function TransacoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // primeiro pedaço pequeno; o resto vem no "carregar mais"
  const res = await apiFetch<{ items: Tx[]; total?: number }>("/api/payments/transactions?limit=50");
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Financeiro"
        title="Transações"
        description={<>Pagamentos Pix/cartão (Mercado Pago e InfinitePay) — do PDV e do crediário. Use "forçar/verificar" para consultar o status e dar baixa quando travar.</>}
      />
      <TransacoesClient initial={res.data?.items ?? []} total={res.data?.total ?? 0} />
    </div>
  );
}
