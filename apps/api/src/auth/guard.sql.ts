import { CONTEXT_CTE, PROOF_CTE, PROOF_SELECT, TIED_TO_CTX } from "../prisma/rls-context";

/**
 * AS CONSULTAS DO GUARD
 * ============================================================================
 * O guard roda em toda requisição; aqui estão as duas consultas que ele faz,
 * cada uma em uma instrução só.
 *
 * ---------------------------------------------------------------------------
 * QUEM É ESTA PESSOA
 * ============================================================================
 * O guard roda em TODA requisição. Ele resolvia a sessão assim:
 *
 *   sessions.findUnique({ include: { activeMembership:
 *     { include: { role, store, organization } } } })
 *
 * Um `include` do Prisma vira uma consulta por tabela — sessão, membership,
 * papel, loja, empresa — dentro de uma transação (mais BEGIN, os GUCs e
 * COMMIT). E o master pagava outra transação por cima, mais uma terceira
 * quando estava impersonando.
 *
 * Aqui é uma instrução só, com a mesma garantia de ordem da casca do painel:
 * `ctx` seta os GUCs e cada leitura entra por `FROM ctx, LATERAL (...)`, que é
 * avaliado por linha de `ctx`. O contexto é `is_platform_admin = true` do
 * começo ao fim — era exatamente assim que as três leituras já eram feitas
 * (`runWithContext({ isPlatformAdmin: true })`), porque ninguém consegue ler a
 * própria sessão antes de a sessão existir.
 *
 * `store` e `organization` saíram do include: o guard nunca leu nada delas
 * além do id, que já vem no membership.
 *
 * $8 = hash do cookie de sessão; $9 = hash do cookie do master. Texto vazio
 * quando o cookie não veio.
 */
export const SESSION_SQL = `WITH ${CONTEXT_CTE},

  ${PROOF_CTE},

  sess AS MATERIALIZED (
    SELECT s.* FROM ctx, LATERAL (
      SELECT se.user_id AS "userId",
             se.revoked_at AS "revokedAt",
             se.expires_at AS "expiresAt",
             m.id AS "membershipId",
             m.organization_id AS "orgId",
             m.store_id AS "storeId",
             m.permissions AS "membershipPermissions",
             r.id AS "roleId",
             r.slug AS "roleSlug",
             r.permissions AS "rolePermissions",
             u0.must_reset_password AS "mustResetPassword"
        FROM sessions se
        -- o status active não é detalhe: vínculo revogado (ou suspenso, ou
        -- ainda pendente) não pode continuar dando empresa, papel e permissões
        -- pra uma sessão já aberta. É a mesma regra que as policies de RLS
        -- usam. Sem ele, "revogar o acesso" não expulsava ninguém.
        LEFT JOIN memberships m ON m.id = se.active_membership_id AND m.status = 'active'
        LEFT JOIN roles r ON r.id = m.role_id
        LEFT JOIN users u0 ON u0.id = se.user_id
       WHERE se.token_hash = nullif($8, '') AND ${TIED_TO_CTX}
       OFFSET 0
    ) s
  ),

  psess AS MATERIALIZED (
    SELECT p.* FROM ctx, LATERAL (
      SELECT ps.id,
             ps.platform_user_id AS "platformUserId",
             ps.revoked_at AS "revokedAt",
             ps.expires_at AS "expiresAt",
             ps.impersonating_org_id AS "impersonatingOrgId",
             ps.tech_specs_categories AS "techSpecsCategories",
             pu.role AS "platformUserRole"
        FROM platform_sessions ps
        LEFT JOIN platform_users pu ON pu.id = ps.platform_user_id
       WHERE ps.token_hash = nullif($9, '') AND ${TIED_TO_CTX}
       OFFSET 0
    ) p
  ),

  -- membership representativo da empresa impersonada. Depende de \`psess\`:
  -- só existe se houver sessão de master com empresa em curso.
  imp AS MATERIALIZED (
    SELECT i.* FROM psess, LATERAL (
      SELECT o0.name AS "orgName",
             m.id AS "membershipId",
             m.user_id AS "userId",
             m.store_id AS "storeId",
             m.permissions AS "membershipPermissions",
             r.slug AS "roleSlug",
             r.permissions AS "rolePermissions"
        FROM organizations o0
        -- o vínculo representativo é o mais antigo ATIVO da empresa; a empresa
        -- vem primeiro porque ela existe mesmo quando não há ninguém dentro
        LEFT JOIN LATERAL (
          SELECT m2.* FROM memberships m2
           WHERE m2.organization_id = o0.id AND m2.status = 'active'
           ORDER BY m2.created_at ASC
           LIMIT 1
        ) m ON true
        LEFT JOIN roles r ON r.id = m.role_id
       WHERE o0.id = psess."impersonatingOrgId"
       LIMIT 1 OFFSET 0
    ) i
  )

SELECT (SELECT to_jsonb(s) FROM sess s)  AS sessao,
       (SELECT to_jsonb(p) FROM psess p) AS master,
       (SELECT to_jsonb(i) FROM imp i)   AS impersonado,
       ${PROOF_SELECT}`;

export interface LinhaSessao {
  userId: string;
  revokedAt: string | null;
  expiresAt: string;
  membershipId: string | null;
  orgId: string | null;
  storeId: string | null;
  membershipPermissions: unknown;
  /** só para indexar o cache por papel — não entra no contexto */
  roleId: string | null;
  roleSlug: string | null;
  rolePermissions: unknown;
  mustResetPassword: boolean | null;
}

export interface LinhaMaster {
  id: string;
  platformUserId: string;
  revokedAt: string | null;
  expiresAt: string;
  impersonatingOrgId: string | null;
  techSpecsCategories: string[];
  platformUserRole: string | null;
}

export interface LinhaImpersonacao {
  /** nome da empresa impersonada — o banner do master */
  orgName: string | null;
  /** null quando a empresa não tem ninguém ativo dentro */
  membershipId: string | null;
  userId: string | null;
  storeId: string | null;
  membershipPermissions: unknown;
  roleSlug: string | null;
  rolePermissions: unknown;
}

export interface SessionRow {
  sessao: LinhaSessao | null;
  master: LinhaMaster | null;
  impersonado: LinhaImpersonacao | null;
  /** null = os GUCs do RLS não valiam quando a consulta rodou (ver `PROOF_CTE`) */
  guc_aplicado: string | null;
}


/**
 * Fase do cancelamento da assinatura, para o modo somente-leitura.
 *
 * Roda em toda requisição de ESCRITA de usuário de empresa. Era uma transação
 * (quatro idas) para ler duas colunas; agora é uma instrução.
 *
 * $8 = id da empresa.
 */
export const CANCELLATION_SQL = `WITH ${CONTEXT_CTE},

  ${PROOF_CTE},

  assinatura AS MATERIALIZED (
    SELECT a.* FROM ctx, LATERAL (
      SELECT sb.status, sb.canceled_at AS "canceledAt"
        FROM subscriptions sb
       WHERE sb.organization_id = nullif($8, '')::uuid AND ${TIED_TO_CTX}
       LIMIT 1 OFFSET 0
    ) a
  )

SELECT (SELECT to_jsonb(a) FROM assinatura a) AS assinatura,
       ${PROOF_SELECT}`;

export interface CancellationRow {
  assinatura: { status: string; canceledAt: string | null } | null;
  guc_aplicado: string | null;
}
