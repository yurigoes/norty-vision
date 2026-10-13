import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";
import { AlocacoesClient } from "./AlocacoesClient";

export const dynamic = "force-dynamic";

export default async function AlocacoesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `nav.ts` + `lib/acesso.ts`, aplicados no
  // `app/app/layout.tsx`. Havia aqui um segundo porteiro, `isOrgAdmin` à mão —
  // e dois porteiros numa porta foi o defeito medido em produção: conceder a
  // permissão fazia o item APARECER no menu e a tela responder "Apenas
  // administradores". `acesso.check.mts` confere que não volte.

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Alocações / Cessão de mão de obra"
        description="Funcionário contratado pela sua empresa (empregadora legal) mas que trabalha em outra (tomadora). A folha, o ponto fiscal (AFD/AEJ) e o eSocial continuam na sua empresa; a tomadora apenas acompanha as horas."
      />
      <AlocacoesClient />
    </div>
  );
}
