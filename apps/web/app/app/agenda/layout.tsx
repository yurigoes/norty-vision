import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";

export const dynamic = "force-dynamic";

/**
 * Só a guarda de acesso. A navegação entre as telas da Agenda são as abas do
 * módulo (`lib/nav.ts` → `components/ModuleTabs.tsx`), que o `PageHeader`
 * renderiza sozinho — antes era um trilho lateral daqui, que não marcava a
 * tela atual e sumia abaixo de 1024px.
 */
export default async function AgendaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  return <>{children}</>;
}
