import { getBootstrap } from "./bootstrap";

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
 * Sessão atual do request.
 *
 * Hoje é uma leitura do `getBootstrap()` — a MESMA resposta que a casca do
 * painel usa para empresa, loja, assinatura e atalhos. Com o `cache()` do
 * React, layout e página dividem uma única ida à API dentro da requisição;
 * antes cada `getSession()` batia de novo em `/api/auth/me`.
 *
 * Tolerância a falhas (inalterada, detalhada em `lib/bootstrap.ts`): só
 * retorna `authenticated: false` se a API respondeu 401/403. Timeout, erro de
 * rede ou 5xx mantêm "soft auth" com base no cookie presente — evita expulsar
 * o usuário pra /login só porque a API piscou (era a causa de "ao finalizar
 * pedido o sistema desloga").
 */
export async function getSession(): Promise<SessionSnapshot> {
  return (await getBootstrap()).session;
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
