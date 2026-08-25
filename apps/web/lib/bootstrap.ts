import { cache } from "react";
import { cookies } from "next/headers";
import type { SessionSnapshot } from "./session";

/**
 * BOOTSTRAP DA CASCA DO PAINEL
 * ============================================================================
 * O layout do `/app` é `force-dynamic`: ele roda inteiro a cada navegação.
 * E ele buscava, uma depois da outra:
 *
 *   /api/auth/me → /api/platform/integrations → /api/organizations/me
 *   → /api/company-integrations/shortcuts → /api/stores/:id
 *   → /api/subscriptions/current
 *
 * Seis idas e voltas em série, mais uma sétima porque cada página também
 * chamava `getSession()` por conta própria. Era isso que fazia o sistema
 * "pensar" entre uma tela e outra.
 *
 * Agora é uma chamada só (`GET /api/bootstrap`), resolvida em paralelo dentro
 * da API, e o `cache()` do React faz layout e página compartilharem o mesmo
 * resultado dentro da mesma requisição.
 */

export interface OrgShortcut {
  provider: string;
  label: string;
  url: string;
}

export interface BootstrapSnapshot {
  session: SessionSnapshot;
  /** organização do usuário, com módulos do plano já resolvidos */
  organization: any | null;
  /** loja ativa (branding da loja tem precedência sobre o da empresa) */
  store: any | null;
  subscription: any | null;
  shortcuts: OrgShortcut[];
  chatwoot: { baseUrl: string; websiteToken: string } | null;
}

const EMPTY: BootstrapSnapshot = {
  session: { authenticated: false, user: null, master: null },
  organization: null,
  store: null,
  subscription: null,
  shortcuts: [],
  chatwoot: null,
};

function apiBase(): string {
  return process.env.API_INTERNAL_URL ?? "http://api:3001";
}

async function cookieHeader(): Promise<{ header: string; hasSession: boolean }> {
  const jar = await cookies();
  return {
    header: jar.getAll().map((c) => `${c.name}=${c.value}`).join("; "),
    hasSession: jar.getAll().some((c) => /session|token/i.test(c.name)),
  };
}

/**
 * Tudo que a casca precisa, numa requisição.
 *
 * Tolerância a falha (a mesma de antes): só devolve "não autenticado" quando a
 * API responde 401/403. Timeout, erro de rede ou 5xx mantêm "soft auth" com
 * base no cookie presente — era a causa de "ao finalizar pedido o sistema
 * desloga", quando um piscar do backend derrubava a sessão do usuário.
 */
export const getBootstrap = cache(async (): Promise<BootstrapSnapshot> => {
  const { header, hasSession } = await cookieHeader();
  const base = apiBase();

  try {
    const res = await fetch(`${base}/api/bootstrap`, {
      headers: { cookie: header },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 || res.status === 403) return EMPTY;

    // API ainda sem o endpoint (deploy pela metade): usa o caminho antigo.
    if (res.status === 404) return legacyBootstrap(base, header, hasSession);

    if (!res.ok) return softAuth(hasSession, `HTTP ${res.status}`);

    const data = (await res.json()) as Partial<BootstrapSnapshot> | null;
    if (!data?.session) return softAuth(hasSession, "resposta sem sessão");

    return {
      session: data.session,
      organization: data.organization ?? null,
      store: data.store ?? null,
      subscription: data.subscription ?? null,
      shortcuts: Array.isArray(data.shortcuts) ? data.shortcuts : [],
      chatwoot: data.chatwoot ?? null,
    };
  } catch (e) {
    const motivo = e instanceof Error && e.name === "TimeoutError" ? "timeout de 8s" : String(e);
    return softAuth(hasSession, motivo);
  }
});

/**
 * "Soft auth": a API não respondeu (timeout, rede, 5xx), mas há cookie de
 * sessão — mantém o usuário dentro em vez de expulsá-lo pro login.
 *
 * Continua sendo a rede de segurança, mas agora DEIXA RASTRO. Antes era
 * silencioso: quando acontecia, ninguém ficava sabendo, e o sintoma chegava
 * como "o sistema me deslogou do nada" sem nada no log pra confirmar. Se esta
 * linha aparecer com frequência, o problema é a API estar lenta — não o front.
 */
function softAuth(hasSession: boolean, motivo: string): BootstrapSnapshot {
  if (hasSession) {
    console.warn(
      `[auth] /api/bootstrap não respondeu (${motivo}) — mantendo a sessão pelo cookie. ` +
        `Se isto se repetir, investigue a latência da API.`,
    );
  }
  return { ...EMPTY, session: { authenticated: hasSession, user: null, master: null } };
}

/**
 * Caminho antigo, um endpoint por peça — só entra em cena se a API rodando for
 * anterior ao `/api/bootstrap`. Aqui as peças já vão em paralelo.
 */
async function legacyBootstrap(
  base: string,
  header: string,
  hasSession: boolean,
): Promise<BootstrapSnapshot> {
  const get = async <T,>(path: string): Promise<T | null> => {
    try {
      const r = await fetch(`${base}${path}`, {
        headers: { cookie: header },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      return null;
    }
  };

  const me = await get<SessionSnapshot>("/api/auth/me");
  if (!me) return softAuth(hasSession, "caminho antigo: /api/auth/me falhou");
  if (!me.authenticated) return { ...EMPTY, session: me };

  const isMaster = me.master !== null;
  const [org, store, sub, sc, integrations] = await Promise.all([
    me.user?.orgId ? get<{ organization: any }>("/api/organizations/me") : null,
    me.user?.storeId ? get<{ store: any }>(`/api/stores/${me.user.storeId}`) : null,
    me.user?.orgId && !isMaster ? get<{ subscription: any }>("/api/subscriptions/current") : null,
    me.user?.isOrgAdmin ? get<{ items: OrgShortcut[] }>("/api/company-integrations/shortcuts") : null,
    isMaster ? get<{ integrations: any[] }>("/api/platform/integrations") : null,
  ]);

  const cw = (integrations?.integrations ?? []).find((i) => i.provider === "chatwoot");
  const token = (cw?.config ?? {})?.chatwootWebsiteToken;
  const chatwoot =
    cw && cw.status === "active" && cw.embedEnabled && token
      ? { baseUrl: cw.baseUrl as string, websiteToken: token as string }
      : null;

  return {
    session: me,
    organization: org?.organization ?? null,
    store: store?.store ?? null,
    subscription: sub?.subscription ?? null,
    shortcuts: sc?.items ?? [],
    chatwoot,
  };
}

/**
 * Organização atual — do mesmo `getBootstrap()` que a casca já carregou.
 *
 * Páginas que precisam do nicho, do slug ou do branding não têm por que pedir
 * `/api/organizations/me` de novo: dentro da mesma requisição o `cache()`
 * devolve o que o layout já buscou.
 */
export async function getOrganization<T = any>(): Promise<T | null> {
  return ((await getBootstrap()).organization ?? null) as T | null;
}
