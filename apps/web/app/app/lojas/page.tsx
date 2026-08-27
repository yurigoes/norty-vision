import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { StoresClient } from "./StoresClient";
import { OrgBrandingCard } from "./OrgBrandingCard";
import { KioskPanelsCard } from "./KioskPanelsCard";
import { loginPath } from "../../../lib/tenantServer";
import { getOrganization } from "../../../lib/bootstrap";
import { PageHeader } from "../../../components/PageHeader";

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
  if (!session.authenticated) redirect(await loginPath());
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

  // já veio no bootstrap da casca — sem nova ida à API
  const orgBrand = await getOrganization();

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Configuração · Lojas"
        title="Suas lojas"
        description="Cada loja tem agenda, leads e disparador próprios. Adicione filiais, franquias ou pontos de atendimento."
      />

      <OrgBrandingCard initial={orgBrand} />

      <KioskPanelsCard niche={orgBrand?.niche} />

      <StoresClient initialStores={stores} />
    </div>
  );
}
