import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { GrantsClient } from "./GrantsClient";

export const dynamic = "force-dynamic";

export default async function GrantsPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (session.master === null) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas o master acessa esta área.</p></div>;
  }
  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master · Acessos</p>
        <h1 className="mt-1 text-3xl font-semibold">Acessos às Specs</h1>
        <p className="mt-2 text-muted">Defina quais categorias das Specs Técnicas cada membro do suporte pode ver. O <b>owner</b> sempre vê todas.</p>
      </header>
      <GrantsClient />
    </div>
  );
}
