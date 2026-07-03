import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { MalaDiretaClient } from "./MalaDiretaClient";

export const dynamic = "force-dynamic";

export default async function MalaDiretaPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Marketing</p>
        <h1 className="mt-1 text-3xl font-semibold">Mala direta</h1>
        <p className="mt-2 text-muted">
          Dispare promoções e novidades por e-mail (HTML com sua marca) e
          WhatsApp (texto ou imagem). Só recebe quem não optou por sair.
        </p>
      </header>

      <MalaDiretaClient />
    </div>
  );
}
