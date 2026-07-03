import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { StoresClient } from "./StoresClient";
import { OrgBrandingCard } from "./OrgBrandingCard";
import { KioskPanelsCard } from "./KioskPanelsCard";

export const dynamic = "force-dynamic";

interface Store {
  id: string;
  slug: string;
  name: string;
  document: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  status: string;
  createdAt: string;
  themePrimaryColor: string | null;
  logoUrl: string | null;
  themeMode: string | null;
}

export default async function LojasPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores ou owners da organização podem acessar a
          gestão de lojas.
        </p>
      </div>
    );
  }

  const { data } = await apiFetch<{ items: Store[] }>("/api/stores");
  const stores = data?.items ?? [];

  const orgRes = await apiFetch<{ organization: any }>("/api/organizations/me");
  const orgBrand = orgRes.data?.organization ?? null;

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Lojas
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Suas lojas</h1>
        <p className="mt-2 text-muted">
          Cada loja tem agenda, leads e disparador próprios. Adicione filiais,
          franquias ou pontos de atendimento.
        </p>
      </header>

      <OrgBrandingCard initial={orgBrand} />

      <KioskPanelsCard niche={orgBrand?.niche} />

      <StoresClient initialStores={stores} />
    </div>
  );
}
