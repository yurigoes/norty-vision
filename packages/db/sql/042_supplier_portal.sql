-- ==============================================================================
-- 042_supplier_portal.sql
-- Portal do fornecedor (/f): sessoes + flag de troca de senha obrigatoria.
-- Senha inicial = documento (CPF/CNPJ sem pontuacao); troca obrigatoria no
-- primeiro acesso. Mesma regra (must_reset) aplicada ao cliente (crediario).
-- ==============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS portal_last_login_at timestamptz;

ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS supplier_sessions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  ip_address      inet,
  user_agent      text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_sessions_supplier_idx ON supplier_sessions (supplier_id);

ALTER TABLE supplier_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_sessions_rls ON supplier_sessions;
CREATE POLICY supplier_sessions_rls ON supplier_sessions FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON COLUMN suppliers.must_reset_password IS
  'Forca troca de senha no 1o acesso (senha inicial = documento).';
