import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";
import { AssiduidadeClient } from "./AssiduidadeClient";

export const dynamic = "force-dynamic";

export default async function AssiduidadePage() {
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
        title="Assiduidade (bônus)"
        description="Calcula quem recebe o bônus de assiduidade no mês, gera os recibos em lote e libera para assinatura no portal do colaborador."
      />
      <AssiduidadeClient />
    </div>
  );
}
