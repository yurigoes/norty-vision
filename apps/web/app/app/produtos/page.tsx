import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ProductsClient } from "./ProductsClient";

export const dynamic = "force-dynamic";

interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  imageUrl: string | null;
  priceCashCents: number | null;
  priceCardFullCents: number | null;
  priceCardInstallmentsCents: number | null;
  priceCreditCents: number | null;
  creditInterestPct: number | null;
  earlyPaymentDiscountPct: number | null;
  maxInstallments: number | null;
  stockQty: number;
  trackStock: boolean;
  isActive: boolean;
}

export default async function ProdutosPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar produtos.
        </p>
      </div>
    );
  }

  const [{ data }, supRes, storesRes, orgRes] = await Promise.all([
    apiFetch<{ items: Product[] }>("/api/products"),
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/stores"),
    apiFetch<{ organization: any }>("/api/organizations/me"),
  ]);
  const labs = (supRes.data?.items ?? []).filter((s) => s.type === "laboratorio").map((s) => ({ id: s.id, name: s.name }));
  const stores = (storesRes.data?.items ?? []).map((s: any) => ({ id: s.id, name: s.name }));
  const niche = orgRes.data?.organization?.niche ?? null;

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Produtos
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Catálogo</h1>
        <p className="mt-2 text-muted">
          Cada produto tem 4 preços (à vista, cartão à vista, cartão parcelado,
          crediário). O cliente só vê o preço final da forma escolhida.
        </p>
      </header>

      <ProductsClient initialProducts={data?.items ?? []} labs={labs} stores={stores} niche={niche} />
    </div>
  );
}
