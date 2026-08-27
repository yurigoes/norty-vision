import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { NichesAdminClient } from "./NichesAdminClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Niche {
  id: string;
  key: string;
  label: string;
  hiddenModuleKeys: string[];
  isActive: boolean;
  displayOrder: number;
}

export default async function PlatformNichesPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  const { data } = await apiFetch<{ items: Niche[] }>("/api/niches/admin/all");

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Master · Nichos"
        title="Nichos de mercado"
        description="Crie os nichos (ótica, gráfica, joalheria, barbearia…) e defina, em cada um, quais módulos NÃO aparecem pras empresas dele. Módulo desmarcado some da sidebar das empresas desse nicho. Módulo novo aparece pra todos por padrão."
      />

      <NichesAdminClient initial={data?.items ?? []} />
    </div>
  );
}
