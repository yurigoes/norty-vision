import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { CredentialsVault } from "./CredentialsVault";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const session = await getSession();
  if (!session.master) redirect("/app");

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Master · Credenciais"
        title="Cofre de senhas"
        description={<>Credenciais administrativas dos sistemas integrados (Chatwoot, GLPI, Evolution, banco, storage). Protegido por <strong>senha mestra</strong>{" "} separada do seu login.</>}
      />

      <CredentialsVault />
    </div>
  );
}
