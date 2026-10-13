import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { VoipAdminClient } from "./VoipAdminClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function VoipAdminPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O PORTEIRO DESTA TELA É O `perm` DELA NO `nav.ts` (lib/acesso.ts, aplicado
  // no layout de /app). Aqui havia um segundo porteiro à mão, exigindo
  // isOrgAdmin — e ele VENCIA, porque a página roda depois do layout. O efeito:
  // conceder a permissão fazia o item APARECER no menu e a tela responder
  // "Apenas administradores". Permissão concedida que não abre nada.
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Call Center · Configuração"
        title="Linhas, números e grupos"
        description="Configure os trunks SIP da empresa, os números (DIDs) e os grupos de ramal que recebem as chamadas. As mudanças se propagam pro PABX em até 30 segundos."
      />
      <VoipAdminClient />
    </div>
  );
}
