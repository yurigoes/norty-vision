/**
 * URL pública por empresa (slug → subdomínio).
 *
 * Toda notificação ao CLIENTE precisa apontar pro portal da empresa dele, e não
 * pro apex "yugochat.com.br". A empresa apex (slug = PLATFORM_ORG_SLUG, default
 * "yugo") usa o domínio raiz; qualquer outra usa "<slug>.<raiz>".
 *
 *   yugo         → https://yugochat.com.br
 *   zito-oticas  → https://zito-oticas.yugochat.com.br
 *
 * O domínio raiz vem de DOMAIN (fallback yugochat.com.br).
 */
export function orgBaseUrl(slug?: string | null): string {
  const root = (process.env.DOMAIN ?? "vision.norty.com.br").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const apex = process.env.PLATFORM_ORG_SLUG ?? "norty-vision";
  const s = (slug ?? "").trim().toLowerCase();
  if (!s || s === apex) return `https://${root}`;
  return `https://${s}.${root}`;
}
