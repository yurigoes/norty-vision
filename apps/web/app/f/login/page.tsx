import { redirect } from "next/navigation";
import { rememberedOrgSlug } from "../../../lib/tenantServer";
import { loginPathFor } from "../../../lib/orgMemory";
import { SupplierLoginForm } from "../SupplierLoginForm";

export const dynamic = "force-dynamic";

/**
 * `/f/login` — porta genérica do portal do fornecedor. Com empresa lembrada,
 * vai direto pro portal dela; senão o formulário deriva o slug do subdomínio.
 */
export default async function SupplierLoginPage() {
  const slug = await rememberedOrgSlug();
  if (slug) redirect(loginPathFor("fornecedor", slug));
  return <SupplierLoginForm />;
}
