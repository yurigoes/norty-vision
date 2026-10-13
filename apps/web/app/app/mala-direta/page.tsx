import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { MalaDiretaClient } from "./MalaDiretaClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MalaDiretaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence.

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
