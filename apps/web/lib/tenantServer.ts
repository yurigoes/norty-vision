import { cookies, headers } from "next/headers";
import { ORG_COOKIE, isValidSlug, loginPathFor, withNext, type Portal } from "./orgMemory";

/**
 * Lado servidor da memória de empresa (ver `lib/orgMemory.ts`).
 *
 * Usado nos Server Components pra mandar quem perdeu a sessão de volta pra
 * PORTA DA EMPRESA (`/e/<slug>/login`) em vez do `/login` genérico, já
 * carregando `?next=` com a página que ele tentou abrir.
 */

/** Slug da empresa lembrado no cookie do navegador (null se não houver). */
export async function rememberedOrgSlug(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(ORG_COOKIE)?.value ?? null;
  return isValidSlug(value) ? value : null;
}

/**
 * Caminho atual da requisição (`/app/agenda?dia=hoje`), publicado pelo
 * middleware no header `x-nv-path`. Sem middleware (ex.: build) → null.
 */
export async function currentPath(): Promise<string | null> {
  const h = await headers();
  const path = h.get("x-nv-path");
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/**
 * Para onde mandar quem não está autenticado: login da empresa lembrada
 * (com marca) + `?next=` da página pedida. Sem empresa lembrada, cai no
 * login genérico — comportamento antigo.
 */
export async function loginPath(portal: Portal = "equipe"): Promise<string> {
  const [slug, path] = await Promise.all([rememberedOrgSlug(), currentPath()]);
  return withNext(loginPathFor(portal, slug), path);
}
