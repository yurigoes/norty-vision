import { redirect } from "next/navigation";
import { rememberedOrgSlug } from "../../../lib/tenantServer";
import { loginPathFor } from "../../../lib/orgMemory";
import { CustomerLoginForm } from "./CustomerLoginForm";

export const dynamic = "force-dynamic";

/**
 * `/c/login` — porta genérica do portal do cliente. Com empresa lembrada
 * neste aparelho, vai direto pro portal dela (marca + escopo corretos).
 */
export default async function CustomerLoginPage() {
  const slug = await rememberedOrgSlug();
  if (slug) redirect(loginPathFor("cliente", slug));
  return <CustomerLoginForm />;
}
