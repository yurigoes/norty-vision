import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { NichesAdminClient } from "./NichesAdminClient";

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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master · Nichos</p>
        <h1 className="mt-1 text-3xl font-semibold">Nichos de mercado</h1>
        <p className="mt-2 text-muted">
          Crie os nichos (ótica, gráfica, joalheria, barbearia…) e defina, em cada um,
          quais módulos NÃO aparecem pras empresas dele. Módulo desmarcado some da sidebar
          das empresas desse nicho. Módulo novo aparece pra todos por padrão.
        </p>
      </header>

      <NichesAdminClient initial={data?.items ?? []} />
    </div>
  );
}
