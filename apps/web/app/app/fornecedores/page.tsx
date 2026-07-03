import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { SuppliersClient } from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default async function FornecedoresPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Apenas administradores podem gerenciar fornecedores.
        </p>
      </div>
    );
  }

  const [suppliersRes, orgRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/suppliers"),
    apiFetch<{ organization: { niche: string | null } }>("/api/organizations/me"),
  ]);
  const niche = orgRes.data?.organization?.niche ?? null;
  // Conteúdo do header adapta ao nicho. Ótica fala em médicos/laboratórios;
  // gráfica e demais ficam em "Fornecedores" genérico (inclui costureira).
  const isOtica = niche === "otica" || niche === "óptica" || niche === "optica";
  const title = isOtica ? "Médicos e laboratórios" : "Fornecedores";
  const subtitle = isOtica
    ? "Cadastre os médicos (com a regra de repasse por exame) e os laboratórios. Eles aparecem nos pedidos de lente e nos repasses."
    : "Cadastre quem fornece pra você: costureira, fornecedor de tecido, transportadora, etc. Costureiras aparecem na atribuição de OS e no portal mobile delas.";

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Fornecedores
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-muted">{subtitle}</p>
      </header>

      <SuppliersClient initial={suppliersRes.data?.items ?? []} niche={niche} />
    </div>
  );
}
