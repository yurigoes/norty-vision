import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";

export const dynamic = "force-dynamic";

/** Só a guarda de acesso — a navegação são as abas do módulo. */
export default async function ContratosLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores podem gerenciar contratos.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
