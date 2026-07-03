import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { MfaSetupCard } from "./MfaSetupCard";

export const dynamic = "force-dynamic";

export default async function SegurancaPage() {
  const session = await getSession();
  if (!session.user) redirect("/login");

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Perfil · Segurança
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Proteja sua conta</h1>
        <p className="mt-2 text-muted">
          Ative o 2FA (autenticação em dois fatores) com um app como Google
          Authenticator, Authy ou 1Password. Depois de ativo, o login passa a
          exigir o código de 6 dígitos.
        </p>
      </header>

      <MfaSetupCard />
    </div>
  );
}
