import { cache } from "react";
import { headers } from "next/headers";

export interface OrgBranding {
  /** Slug da org, se estamos num subdomínio dela. null = apex (sem org). */
  slug: string | null;
  /** Nome a exibir (org > plataforma). */
  name: string;
  /** Logo branding. null se ainda não definiu. */
  logoUrl: string | null;
  /** Favicon. */
  faviconUrl: string | null;
  /** Cor primária (hex). null se não definiu. */
  primaryColor: string | null;
}

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "yugochat.com.br").toLowerCase();
const RESERVED = new Set([
  "www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets", "n8n",
  "chat", "chatwoot", "glpi", "evolution", "minio", "s3",
]);

/**
 * Detecta o slug da org pelo host da request (server-side).
 * `zito-oticas.yugochat.com.br` → "zito-oticas".
 * Apex / reservado / qualquer fallback → null.
 */
export async function orgSlugFromRequest(): Promise<string | null> {
  try {
    const h = await headers();
    const host = (h.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
    if (!host.endsWith(ROOT_DOMAIN)) return null;
    const sub = host.slice(0, host.length - ROOT_DOMAIN.length).replace(/\.$/, "");
    if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
    return sub;
  } catch {
    return null;
  }
}

/**
 * Carrega o branding da org logo no início do RSC. Quando em subdomínio,
 * retorna info da empresa. No apex / quando der erro, retorna placeholders
 * mas mantém slug=null pra layouts saberem.
 *
 * O importante é: NUNCA mistura branding do Yugo (plataforma) numa página
 * que pertence a uma empresa. Se acessou pelo subdomínio dela, ela é a marca.
 */
export const getOrgBrandingFromHost = cache(async (): Promise<OrgBranding> => {
  const slug = await orgSlugFromRequest();
  if (!slug) {
    return { slug: null, name: "yugochat", logoUrl: null, faviconUrl: null, primaryColor: null };
  }
  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";
  try {
    const res = await fetch(`${apiBase}/api/organizations/public/by-slug/${slug}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // erro de rede / 5xx → mantém slug mas sem detalhes; UI usa o slug bonito
      return { slug, name: slug, logoUrl: null, faviconUrl: null, primaryColor: null };
    }
    const d = (await res.json()) as any;
    const o = d?.organization ?? {};
    return {
      slug,
      name: o.name ?? slug,
      logoUrl: o.logoUrl ?? null,
      faviconUrl: o.faviconUrl ?? o.logoUrl ?? null,
      primaryColor: o.primaryColor ?? null,
    };
  } catch {
    return { slug, name: slug, logoUrl: null, faviconUrl: null, primaryColor: null };
  }
});
