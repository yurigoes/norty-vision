import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { MalaDiretaClient } from "./MalaDiretaClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MalaDiretaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores podem enviar mala direta.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Marketing"
        title="Mala direta"
        description="Dispare promoções e novidades por e-mail (HTML com sua marca) e WhatsApp (texto ou imagem). Só recebe quem não optou por sair."
      />

      <MalaDiretaClient />
    </div>
  );
}
