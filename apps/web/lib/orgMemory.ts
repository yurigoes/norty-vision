/**
 * MEMÓRIA DA EMPRESA (slug) NO NAVEGADOR
 * ============================================================================
 * O Vision é multi-empresa e cada empresa tem a própria porta de entrada:
 *
 *   /e/<slug>/login    equipe / administração
 *   /rh/<slug>/login   portal do funcionário
 *   /c/<slug>/login    portal do cliente
 *   /f/<slug>/login    portal do fornecedor
 *
 * Antes, ao entrar por `/e/zito-oticas/login` o app caía em `/app` e o "Sair"
 * devolvia o usuário pro `/login` genérico (apex) — que não sabe de qual
 * empresa ele é. O funcionário se perdia.
 *
 * Aqui guardamos o slug num cookie legível pelo browser (`nv_org`, 1 ano) que
 * funciona como "última empresa usada neste aparelho". Com ele:
 *   - sair volta pra porta da empresa (com logo e cor dela);
 *   - abrir `/login` (ou `/rh/login`, `/c/login`, `/f/login`) redireciona
 *     automaticamente pra porta da empresa;
 *   - sessão expirada volta pro login certo, preservando a página pedida.
 *
 * Não é fronteira de segurança — é só navegação. Quem valida empresa +
 * permissão continua sendo a API (o backend rejeita login fora do org do slug).
 */

export const ORG_COOKIE = "nv_org";
export const ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano

/** Portais de entrada do sistema. */
export type Portal = "equipe" | "funcionario" | "cliente" | "fornecedor";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,49}$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value);
}

/** Rótulos e descrições dos portais — usados no hub `/e/<slug>` e nos logins. */
export const PORTAL_META: Record<Portal, { title: string; short: string; desc: string }> = {
  equipe: {
    title: "Equipe / administração",
    short: "Equipe",
    desc: "Agenda, vendas, caixa e financeiro do dia a dia.",
  },
  funcionario: {
    title: "Portal do funcionário",
    short: "Funcionário",
    desc: "Ponto, holerite, férias e solicitações.",
  },
  cliente: {
    title: "Portal do cliente",
    short: "Cliente",
    desc: "Compras, crediário, ordens de serviço e chamados.",
  },
  fornecedor: {
    title: "Portal do fornecedor",
    short: "Fornecedor",
    desc: "Pedidos, produção e repasses de parceiros.",
  },
};

/**
 * Caminho do login de um portal. Com slug → porta da empresa (com marca).
 * Sem slug → login genérico (apex), que só serve pro master e pra quem
 * ainda não tem empresa lembrada.
 */
export function loginPathFor(portal: Portal, slug?: string | null): string {
  const s = isValidSlug(slug) ? slug : null;
  switch (portal) {
    case "funcionario":
      return s ? `/rh/${s}/login` : "/rh/login";
    case "cliente":
      return s ? `/c/${s}/login` : "/c/login";
    case "fornecedor":
      return s ? `/f/${s}/login` : "/f/login";
    case "equipe":
    default:
      return s ? `/e/${s}/login` : "/login";
  }
}

/** Hub da empresa (escolha de portal). Sem slug não existe hub. */
export function orgHubPath(slug?: string | null): string | null {
  return isValidSlug(slug) ? `/e/${slug}` : null;
}

/**
 * `?next=` só aceita caminho interno absoluto ("/app/agenda"). Bloqueia
 * "//host" e URLs completas — senão vira open redirect depois do login.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // nunca voltar pra uma tela de entrada (viraria loop de login)
  const path = next.split("?")[0];
  if (path === "/login") return null;
  if (/^\/e\/[^/]+(\/login)?$/.test(path)) return null;
  if (/^\/(rh|c|f)\/login$/.test(path)) return null;
  if (/^\/(rh|c|f)\/[^/]+\/login$/.test(path)) return null;
  return next;
}

/** Anexa `?next=` a um caminho de login, quando houver destino válido. */
export function withNext(path: string, next?: string | null): string {
  const safe = safeNext(next);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(safe)}`;
}

/* ---------------------------------------------------------------- browser -- */

/** Lê o slug lembrado neste navegador (null se não houver / for inválido). */
export function readOrgSlug(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)nv_org=([^;]*)/);
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isValidSlug(value) ? value : null;
}

/** Guarda a empresa deste aparelho por 1 ano. Ignora slug inválido. */
export function rememberOrgSlug(slug: unknown): void {
  if (typeof document === "undefined" || !isValidSlug(slug)) return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${ORG_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${ORG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Esquece a empresa (usado em "entrar em outra empresa"). */
export function forgetOrgSlug(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ORG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Destino do "Sair" de cada portal, já apontando pra empresa lembrada. */
export function logoutTargetFor(portal: Portal, slug?: string | null): string {
  const remembered = isValidSlug(slug) ? slug : readOrgSlug();
  return loginPathFor(portal, remembered);
}

/**
 * Manda o navegador pra tela de entrada do portal — na empresa lembrada.
 *
 * `keepNext` (padrão) guarda a página atual em `?next=`, então depois de
 * entrar o usuário volta exatamente pra onde estava. No "Sair" use
 * `keepNext: false` — sair é sair, não é pra voltar pra mesma tela.
 */
export function goToLogin(portal: Portal, opts?: { keepNext?: boolean }): void {
  if (typeof window === "undefined") return;
  const base = loginPathFor(portal, readOrgSlug());
  const keepNext = opts?.keepNext !== false;
  const next = keepNext ? `${window.location.pathname}${window.location.search}` : null;
  window.location.assign(withNext(base, next));
}
