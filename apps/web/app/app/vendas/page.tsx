import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { SalesClient } from "./SalesClient";

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
  if (!session.authenticated) redirect("/login");

  const [prodRes, storesRes, custRes, accRes, salesRes, cfgRes, sellersRes] = await Promise.all([
    apiFetch<{ items: Product[] }>("/api/products?activeOnly=true"),
    apiFetch<{ items: Store[] }>("/api/stores"),
    apiFetch<{ items: Customer[] }>("/api/customers?limit=300"),
    apiFetch<{ items: Account[] }>("/api/credit/accounts"),
    apiFetch<{ items: any[] }>("/api/sales"),
    apiFetch<{ config: { defaultMaxInstallments: number } }>("/api/credit/config"),
    apiFetch<{ items: Array<{ id: string; name: string }> }>("/api/users/sellers"),
  ]);

  return (
    <div className="max-w-6xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Vendas
        </p>
        <h1 className="mt-1 text-3xl font-semibold">PDV — registrar venda</h1>
        <p className="mt-2 text-muted">
          Escolha cliente, adicione produtos e a forma de pagamento. No
          crediário, o sistema valida o limite automaticamente.
        </p>
      </header>

      <SalesClient
        products={prodRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        customers={custRes.data?.items ?? []}
        accounts={accRes.data?.items ?? []}
        recentSales={salesRes.data?.items ?? []}
        defaultMaxInstallments={cfgRes.data?.config?.defaultMaxInstallments ?? 12}
        sellers={sellersRes.data?.items ?? []}
      />
    </div>
  );
}
