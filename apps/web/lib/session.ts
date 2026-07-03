import { cookies } from "next/headers";

export interface SessionUser {
  id: string;
  membershipId: string | null;
  orgId: string | null;
  storeId: string | null;
  role: string | null;
  isOrgAdmin: boolean;
  /**
   * Permissões granulares do papel + overrides por usuário. Chave plana
   * tipo "agenda.cancel". Use `hasPermission(session, "x.y")` em vez de
   * acessar direto — owner/admin/master ignoram esse mapa e têm acesso total.
   */
  permissions?: Record<string, boolean>;
  mustResetPassword?: boolean;
}

export interface SessionMaster {
  id: string;
  platformRole: "owner" | "support" | null;
  techSpecsCategories: string[];
}

export interface SessionImpersonation {
  orgId: string;
  orgName: string | null;
}

export interface SessionSnapshot {
  authenticated: boolean;
  user: SessionUser | null;
  master: SessionMaster | null;
  impersonating?: SessionImpersonation | null;
}

/**
 * Le a sessao atual chamando /api/auth/me direto pela rede interna do Docker
 * (api:3001) com os cookies do request RSC repassados.
 *
 * Tolerância a falhas: só retorna `authenticated: false` se o backend
 * respondeu 401/403 explicitamente. Em caso de timeout, erro de rede ou
 * 5xx, retorna "soft auth" baseado no cookie presente — evita expulsar
 * o usuário pra /login só porque /api/auth/me piscou (era a causa de
 * "ao finalizar pedido o sistema desloga": o router.refresh() recarregava
 * o RSC, /api/auth/me dava timeout pontual e redirect("/login") batia).
 */
export async function getSession(): Promise<SessionSnapshot> {
  const jar = await cookies();
  const cookieHeader = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const hasSessionCookie = jar.getAll().some((c) => /session|token/i.test(c.name));

  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";

  try {
    const res = await fetch(`${apiBase}/api/auth/me`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    // 401/403 → realmente não autenticado
    if (res.status === 401 || res.status === 403) {
      return { authenticated: false, user: null, master: null };
    }
    // 5xx ou outros → mantém soft auth pra não deslogar por hiccup do backend
    if (!res.ok) {
      return { authenticated: hasSessionCookie, user: null, master: null };
    }
    return (await res.json()) as SessionSnapshot;
  } catch {
    // timeout/erro de rede → soft auth se cookie existe
    return { authenticated: hasSessionCookie, user: null, master: null };
  }
}

/**
 * Verifica se a sessão atual pode executar uma ação.
 * Regras:
 *  - Master da plataforma SEMPRE pode (sem impersonar) — true.
 *  - Owner/admin da org SEMPRE pode — true.
 *  - Demais: precisa ter a chave do catálogo marcada true.
 *
 * Use em RSC pra esconder seções/botões: `if (can(session, "agenda.cancel"))…`
 */
export function can(session: SessionSnapshot | null | undefined, key: string): boolean {
  if (!session) return false;
  if (session.master && !session.impersonating) return true;
  const u = session.user;
  if (!u) return false;
  if (u.isOrgAdmin) return true;
  return u.permissions?.[key] === true;
}
