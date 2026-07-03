import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function AgendaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");

  return (
    <div className="flex gap-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-8 space-y-1 text-sm">
          <p className="mb-3 px-3 text-[10px] uppercase tracking-wider text-muted">
            Agenda
          </p>
          <SubLink href="/app/agenda">Calendário</SubLink>
          <SubLink href="/app/agenda/pendencias">Pendências</SubLink>
          <SubLink href="/app/agenda/pacientes">Pacientes</SubLink>
          <SubLink href="/app/agenda/profissionais">Profissionais</SubLink>
          <SubLink href="/app/agenda/nlu">NLU · Revisão</SubLink>
        </nav>
      </aside>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}

function SubLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-md px-3 py-2 text-fg transition hover:bg-line"
    >
      {children}
    </Link>
  );
}
