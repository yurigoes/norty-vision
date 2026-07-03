import { NextResponse, type NextRequest } from "next/server";

/**
 * Roteamento por subdomínio de empresa.
 *
 * `zitooticas.yugochat.com.br/` → vitrine/landing da empresa (/empresa/zitooticas),
 * com branding forte e botão "Entrar" expondo todos os módulos (cliente, RH,
 * fornecedor, equipe). O apex `yugochat.com.br` continua sendo a landing da YUGO.
 *
 * Só a raiz ("/") é reescrita — os demais caminhos (/c/[slug]/login, /rh/login,
 * /f/login, /login, /loja/[slug]) funcionam normalmente em qualquer host.
 *
 * Requer DNS wildcard `*.yugochat.com.br` apontando para o app (infra do usuário).
 */
const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "yugochat.com.br").toLowerCase();
const RESERVED = new Set([
  "www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets", "n8n",
  "chat", "chatwoot", "glpi", "evolution", "minio", "s3",
]);
// Subdomínios de PRODUTO (ex.: Central de Leads): a raiz não vai pra vitrine
// genérica de empresa — vai pro login da marca (que já detecta o slug e mostra
// logo/cor da org). O login isola o acesso a essa org.
const PRODUCT_SUBDOMAINS = new Set(["centraldeleads"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host.endsWith(ROOT_DOMAIN)) return NextResponse.next();

  // sub = tudo antes do domínio raiz. apex → "" (pula); multi-label → pula.
  const sub = host.slice(0, host.length - ROOT_DOMAIN.length).replace(/\.$/, "");
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return NextResponse.next();

  const url = req.nextUrl.clone();
  // produto: raiz → /login (entrada da marca), não a vitrine de empresa.
  url.pathname = PRODUCT_SUBDOMAINS.has(sub) ? "/login" : `/empresa/${sub}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // só intercepta a raiz exata; assets e demais rotas passam direto.
  matcher: ["/"],
};
