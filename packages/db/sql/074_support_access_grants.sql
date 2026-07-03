-- ==============================================================================
-- 074_support_access_grants.sql
-- Acesso de suporte com token temporário (inspirado em suporte_acessos):
-- o master libera o acesso de SUPORTE a uma empresa por um período (24h/30d/
-- 90d/sempre). Auditável e revogável (inclusive pela própria empresa).
-- O master 'support' só consegue impersonar empresas com grant ativo;
-- o 'owner' (dono do SaaS) tem acesso total e não precisa de grant.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS support_access_grants (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_prefix      text NOT NULL,        -- primeiros chars da chave (exibição)
  key_hash        text NOT NULL,        -- sha256 da chave completa
  duration        text NOT NULL CHECK (duration IN ('24h','30d','90d','sempre')),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,          -- null = sempre
  revoked_at      timestamptz,
  revoke_reason   text,
  last_used_at    timestamptz,
  uses_count      int NOT NULL DEFAULT 0,
  created_by_platform_user_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_access_grants_org_idx ON support_access_grants (organization_id, revoked_at, expires_at);

ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_access_grants_rls ON support_access_grants;
CREATE POLICY support_access_grants_rls ON support_access_grants FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE support_access_grants IS 'Acesso de suporte temporário (token) por empresa; gate da impersonação do suporte.';
