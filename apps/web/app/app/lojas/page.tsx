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
  // O PORTEIRO DESTA TELA É O `perm` DELA NO `nav.ts` (lib/acesso.ts, aplicado
  // no layout de /app). Aqui havia um segundo porteiro à mão, exigindo
  // isOrgAdmin — e ele VENCIA, porque a página roda depois do layout. O efeito:
  // conceder a permissão fazia o item APARECER no menu e a tela responder
  // "Apenas administradores". Permissão concedida que não abre nada.

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
