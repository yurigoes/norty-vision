import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { GrantsClient } from "./GrantsClient";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function GrantsPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (session.master === null) {
    return <div className="max-w-3xl"><p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">Apenas o master acessa esta área.</p></div>;
  }
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Master · Acessos"
        title="Acessos às Specs"
        description={<>Defina quais categorias das Specs Técnicas cada membro do suporte pode ver. O <b>owner</b> sempre vê todas.</>}
      />
      <GrantsClient />
    </div>
  );
}
