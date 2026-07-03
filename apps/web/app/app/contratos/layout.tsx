import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function ContratosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores podem gerenciar contratos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-8 space-y-1 text-sm">
          <p className="mb-3 px-3 text-[10px] uppercase tracking-wider text-muted">
            Contratos
          </p>
          <SubLink href="/app/contratos">Enviados</SubLink>
          <SubLink href="/app/contratos/modelos">Modelos</SubLink>
        </nav>
      </aside>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}

function SubLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl px-3 py-2 text-fg transition hover:bg-surface-2 hover:text-brand"
    >
      {children}
    </Link>
  );
}
