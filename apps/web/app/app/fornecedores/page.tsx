import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { SuppliersClient } from "./SuppliersClient";
import { loginPath } from "../../../lib/tenantServer";
import { getOrganization } from "../../../lib/bootstrap";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function FornecedoresPage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence,
  // e foi assim que conceder a permissão passou a mostrar o item no menu sem
  // abrir a tela.

  const [suppliersRes, org] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/suppliers"),
    getOrganization<{ niche: string | null }>(),
  ]);
  const niche = org?.niche ?? null;
  // Conteúdo do header adapta ao nicho. Ótica fala em médicos/laboratórios;
  // gráfica e demais ficam em "Fornecedores" genérico (inclui costureira).
  const isOtica = niche === "otica" || niche === "óptica" || niche === "optica";
  const title = isOtica ? "Médicos e laboratórios" : "Fornecedores";
  const subtitle = isOtica
    ? "Cadastre os médicos (com a regra de repasse por exame) e os laboratórios. Eles aparecem nos pedidos de lente e nos repasses."
    : "Cadastre quem fornece pra você: costureira, fornecedor de tecido, transportadora, etc. Costureiras aparecem na atribuição de OS e no portal mobile delas.";

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Configuração · Fornecedores"
        title={<>{title}</>}
        description={<>{subtitle}</>}
      />

      <SuppliersClient initial={suppliersRes.data?.items ?? []} niche={niche} />
    </div>
  );
}
