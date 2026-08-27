import { redirect } from "next/navigation";
import { rememberedOrgSlug } from "../../lib/tenantServer";
import { loginPathFor, withNext } from "../../lib/orgMemory";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

/**
 * `/login` — porta genérica da equipe.
 *
 * Quem já usou o sistema neste aparelho tem a empresa lembrada (cookie
 * `nv_org`): é redirecionado pro login DELA (`/e/<slug>/login`), com logo e
 * cor da empresa. Assim o "Sair" e a sessão expirada nunca mais jogam o
 * funcionário numa tela que ele não reconhece.
 *
 * `?global=1` força a tela genérica — é por onde o master entra e por onde se
 * troca de empresa no mesmo aparelho.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const globalMode = sp.global === "1" || sp.master === "1";
  const slug = await rememberedOrgSlug();

  if (slug && !globalMode) {
    const next = typeof sp.next === "string" ? sp.next : null;
    redirect(withNext(loginPathFor("equipe", slug), next));
  }

  return <LoginForm />;
}
