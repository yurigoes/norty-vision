import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VoipClient } from "./VoipClient";

export const dynamic = "force-dynamic";

export default async function VoipPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  return (
    <div className="max-w-3xl">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Central de Atendimento · Telefone</p>
        <h1 className="mt-1 text-3xl font-semibold">Ramal (softphone)</h1>
        <p className="mt-2 text-muted">Seu ramal interno (WebRTC). Ligue para outros operadores pelo nome — interno e grátis. Voz pra fora (PSTN) só com trunk (Fase C).</p>
      </header>
      <VoipClient />
    </div>
  );
}
