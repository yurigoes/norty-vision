import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { ProductsClient } from "./ProductsClient";
import { loginPath } from "../../../lib/tenantServer";
import { getOrganization } from "../../../lib/bootstrap";
import { PageHeader } from "../../../components/PageHeader";

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
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar produtos.
        </p>
      </div>
    );
  }

  const [{ data }, supRes, storesRes, org] = await Promise.all([
    apiFetch<{ items: Product[] }>("/api/products"),
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/stores"),
    getOrganization(),
  ]);
  const labs = (supRes.data?.items ?? []).filter((s) => s.type === "laboratorio").map((s) => ({ id: s.id, name: s.name }));
  const stores = (storesRes.data?.items ?? []).map((s: any) => ({ id: s.id, name: s.name }));
  const niche = org?.niche ?? null;

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuração · Produtos"
        title="Catálogo"
        description="Cada produto tem 4 preços (à vista, cartão à vista, cartão parcelado, crediário). O cliente só vê o preço final da forma escolhida."
      />

      <ProductsClient initialProducts={data?.items ?? []} labs={labs} stores={stores} niche={niche} />
    </div>
  );
}
