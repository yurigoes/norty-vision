import { NextResponse, type NextRequest } from "next/server";
import { ROOT_DOMAIN as BRAND_ROOT_DOMAIN } from "./lib/brand";

/**
 * Middleware do Vision — duas responsabilidades:
 *
 * 1) ROTEAMENTO POR SUBDOMÍNIO DE EMPRESA (só na raiz "/")
 *    `zitooticas.vision.norty.com.br/` → vitrine da empresa (/empresa/zitooticas),
 *    com branding forte e botão "Entrar" expondo todos os módulos (cliente, RH,
 *    fornecedor, equipe). O apex continua sendo a landing da marca.
 *    Requer DNS wildcard apontando para o app (infra do usuário).
 *
 * 2) PUBLICAR O CAMINHO ATUAL no header `x-nv-path`
 *    Server Components não enxergam a própria URL. Com esse header,
 *    `lib/tenantServer.loginPath()` consegue mandar quem perdeu a sessão pro
 *    login DA EMPRESA já com `?next=/app/agenda` — o usuário volta exatamente
 *    pra onde estava, em vez de cair no `/login` genérico e se perder.
 */
const ROOT_DOMAIN = BRAND_ROOT_DOMAIN.toLowerCase();
const RESERVED = new Set([
  "www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets", "n8n",
  "chat", "chatwoot", "glpi", "evolution", "minio", "s3",
  // reservados do esquema 1-nível sob norty.com.br (apex/master do Vision + serviços do PRM)
  "vision", "norty", "sorva", "license", "app-sorva",
]);
// Subdomínios de PRODUTO (ex.: Central de Leads): a raiz não vai pra vitrine
// genérica de empresa — vai pro login da marca (que já detecta o slug e mostra
// logo/cor da org). O login isola o acesso a essa org.
const PRODUCT_SUBDOMAINS = new Set(["centraldeleads"]);

/** Repassa a request adiante anexando `x-nv-path` (caminho + query atuais). */
function withPathHeader(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nv-path", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const isRoot = req.nextUrl.pathname === "/";

  if (!isRoot || !host.endsWith(ROOT_DOMAIN)) return withPathHeader(req);

  // sub = tudo antes do domínio raiz. apex → "" (pula); multi-label → pula.
  const sub = host.slice(0, host.length - ROOT_DOMAIN.length).replace(/\.$/, "");
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return withPathHeader(req);

  const url = req.nextUrl.clone();
  // produto: raiz → /login (entrada da marca), não a vitrine de empresa.
  url.pathname = PRODUCT_SUBDOMAINS.has(sub) ? "/login" : `/empresa/${sub}`;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nv-path", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  // roda em todas as rotas de página (assets, imagens e /api ficam de fora).
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|webmanifest|mp3|woff2?)$).*)"],
};
