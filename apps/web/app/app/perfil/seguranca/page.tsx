import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { MfaSetupCard } from "./MfaSetupCard";
import { loginPath } from "../../../../lib/tenantServer";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SegurancaPage() {
  const session = await getSession();
  if (!session.user) redirect(await loginPath());

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Perfil · Segurança"
        title="Proteja sua conta"
        description="Ative o 2FA (autenticação em dois fatores) com um app como Google Authenticator, Authy ou 1Password. Depois de ativo, o login passa a exigir o código de 6 dígitos."
      />

      <MfaSetupCard />
    </div>
  );
}
