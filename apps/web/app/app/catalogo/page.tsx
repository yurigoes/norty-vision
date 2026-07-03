import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { CatalogClient } from "./CatalogClient";
import { VitrineSettings, type VitrineData } from "./VitrineSettings";

export const dynamic = "force-dynamic";

interface Store {
  id: string;
  slug: string;
  name: string;
  catalogEnabled?: boolean;
  catalogHeadline?: string | null;
  catalogWhatsapp?: string | null;
}
interface Lead {
  id: string;
  storeId: string;
  customerName: string;
  customerPhone: string;
  message: string | null;
  items: Array<{ name: string; qty: number; unitPriceCents: number }>;
  totalCents: string;
  status: string;
  createdAt: string;
}

export default async function CatalogoPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  const [storesRes, leadsRes, orgRes] = await Promise.all([
    apiFetch<{ items: Store[] }>("/api/stores"),
    apiFetch<{ items: Lead[] }>("/api/marketplace/leads"),
    apiFetch<{ organization: { slug: string; name: string } & VitrineData }>("/api/organizations/me"),
  ]);

  const org = orgRes.data?.organization ?? null;
  const orgSlug = org?.slug ?? null;
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "yugochat.com.br";

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Vitrine</p>
        <h1 className="mt-1 text-3xl font-semibold">Catálogo online</h1>
        <p className="mt-2 text-muted">
          Publique seus produtos numa vitrine pública. Os clientes montam o pedido
          e ele chega como lead no seu WhatsApp.
        </p>
      </header>

      {orgSlug && (
        <section className="mb-8 rounded-xl border border-line bg-bg/60 p-5">
          <h2 className="text-sm font-semibold">Endereços da sua empresa</h2>
          <p className="mt-1 text-xs text-muted">
            Cada empresa tem seu próprio endereço com a sua marca. Compartilhe com clientes e equipe.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">Vitrine da loja (subdomínio)</span>
              <code className="text-brand">{orgSlug}.{rootDomain}</code>
            </li>
            <li className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">Portal do cliente (com sua marca)</span>
              <code className="text-brand">{rootDomain}/c/{orgSlug}/login</code>
            </li>
          </ul>
        </section>
      )}

      {org && <VitrineSettings initial={org} slug={orgSlug} rootDomain={rootDomain} />}

      <CatalogClient
        stores={storesRes.data?.items ?? []}
        leads={leadsRes.data?.items ?? []}
        orgSlug={orgSlug}
      />
    </div>
  );
}
