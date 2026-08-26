import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { SalesClient } from "./SalesClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Product {
  id: string;
  name: string;
  imageUrl?: string | null;
  priceCashCents: number | null;
  priceCardFullCents: number | null;
  priceCardInstallmentsCents: number | null;
  priceCreditCents: number | null;
  maxInstallments: number | null;
}
interface Store { id: string; name: string }
interface Customer { id: string; name: string; document: string | null; phone: string | null }
interface Account { id: string; document: string; holderName: string; limitCents: string; usedCents: string; status: string }

export default async function VendasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());

  // o PDV não carrega mais cliente nenhum (eram 300 de 3.000, só pro seletor)
  // e o catálogo virou um pedaço: os dois seletores perguntam ao servidor
  const [prodRes, storesRes, accRes, salesRes, cfgRes, sellersRes] = await Promise.all([
    apiFetch<{ items: Product[]; total?: number }>("/api/products?activeOnly=true&limit=100"),
    apiFetch<{ items: Store[] }>("/api/stores"),
    apiFetch<{ items: Account[] }>("/api/credit/accounts"),
    // o PDV carregava 500 vendas só pro modal de notas/devolução; agora traz 50
    // e o modal pede o resto quando o usuário quiser
    apiFetch<{ items: any[]; total?: number }>("/api/sales?limit=50"),
    apiFetch<{ config: { defaultMaxInstallments: number } }>("/api/credit/config"),
    apiFetch<{ items: Array<{ id: string; name: string }> }>("/api/users/sellers"),
  ]);

  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Vendas"
        title="PDV — registrar venda"
        description="Escolha cliente, adicione produtos e a forma de pagamento. No crediário, o sistema valida o limite automaticamente."
      />

      <SalesClient
        products={prodRes.data?.items ?? []}
        totalProducts={prodRes.data?.total ?? 0}
        stores={storesRes.data?.items ?? []}
        accounts={accRes.data?.items ?? []}
        recentSales={salesRes.data?.items ?? []}
        totalSales={salesRes.data?.total ?? 0}
        defaultMaxInstallments={cfgRes.data?.config?.defaultMaxInstallments ?? 12}
        sellers={sellersRes.data?.items ?? []}
      />
    </div>
  );
}
