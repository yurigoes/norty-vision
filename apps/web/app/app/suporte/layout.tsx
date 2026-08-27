import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";

export const dynamic = "force-dynamic";

/** Só a guarda de acesso — a navegação são as abas do módulo. */
export default async function SuporteLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  return <>{children}</>;
}
