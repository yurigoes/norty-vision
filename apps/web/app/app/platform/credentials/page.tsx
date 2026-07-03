import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { CredentialsVault } from "./CredentialsVault";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Master · Credenciais
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Cofre de senhas</h1>
        <p className="mt-2 text-muted">
          Credenciais administrativas dos sistemas integrados (Chatwoot, GLPI,
          Evolution, banco, storage). Protegido por <strong>senha mestra</strong>{" "}
          separada do seu login.
        </p>
      </header>

      <CredentialsVault />
    </div>
  );
}
