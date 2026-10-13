import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { RhClient } from "./RhClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RhPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `nav.ts` + `lib/acesso.ts`, aplicados no
  // `app/app/layout.tsx`. Havia aqui um segundo porteiro, `isOrgAdmin` à mão —
  // e dois porteiros numa porta foi o defeito medido em produção: conceder a
  // permissão fazia o item APARECER no menu e a tela responder "Apenas
  // administradores". `acesso.check.mts` confere que não volte.

  const [empRes, storesRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/hr/employees"),
    apiFetch<{ items: any[] }>("/api/stores"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Pessoas"
        title={<>RH & Funcionários</>}
        description="Ficha dos funcionários, holerite, ponto eletrônico, solicitações (férias, vale, troca de horário), escala e mural de avisos."
      />

      <RhClient
        initialEmployees={empRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
      />
    </div>
  );
}
