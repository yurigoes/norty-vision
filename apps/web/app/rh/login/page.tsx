import { redirect } from "next/navigation";
import { rememberedOrgSlug } from "../../../lib/tenantServer";
import { loginPathFor } from "../../../lib/orgMemory";
import { EmployeeLoginForm } from "./EmployeeLoginForm";

export const dynamic = "force-dynamic";

/**
 * `/rh/login` — porta genérica do portal do funcionário.
 *
 * Sem empresa no endereço, o login genérico não consegue achar o funcionário
 * (o CPF se repete entre empresas). Se o aparelho já lembra a empresa,
 * mandamos direto pro portal dela — com logo, cor e o CPF já no lugar certo.
 */
export default async function EmployeeLoginPage() {
  const slug = await rememberedOrgSlug();
  if (slug) redirect(loginPathFor("funcionario", slug));
  return <EmployeeLoginForm />;
}
