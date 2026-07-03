import Link from "next/link";
import { getSession } from "../../../lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SuporteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  const isMaster = session.master !== null;

  return (
    <div className="flex gap-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-8 space-y-1 text-sm">
          <p className="mb-3 px-3 text-[10px] uppercase tracking-wider text-muted">
            Suporte
          </p>
          <SubLink href="/app/suporte">Visão geral</SubLink>
          <SubLink href="/app/suporte/ajuda">Ajuda</SubLink>
          <SubLink href="/app/suporte/guia">Guia do sistema</SubLink>
          {isMaster && (
            <SubLink href="/app/suporte/specs">Specs técnicas</SubLink>
          )}
          {isMaster && (
            <SubLink href="/app/suporte/recuperacao">Recuperação &amp; Backup 🔒</SubLink>
          )}
          <div className="my-3 border-t border-line" />
          <SubLink href="/app/suporte/infraestrutura">Infraestrutura</SubLink>
          <SubLink href="/app/suporte/saude">Saúde do sistema</SubLink>
          <SubLink href="/app/suporte/backup">Backup</SubLink>
          <SubLink href="/app/suporte/privacidade">Privacidade · LGPD</SubLink>
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
      className="block rounded-md px-3 py-2 text-fg transition hover:bg-line"
    >
      {children}
    </Link>
  );
}
