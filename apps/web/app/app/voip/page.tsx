import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VoipClient } from "./VoipClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function VoipPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Central de Atendimento · Telefone"
        title="Ramal (softphone)"
        description="Seu ramal interno (WebRTC). Ligue para outros operadores pelo nome — interno e grátis. Voz pra fora (PSTN) só com trunk (Fase C)."
      />
      <VoipClient />
    </div>
  );
}
