-- ==============================================================================
-- 169_user_auth_audit.sql  (idempotente)  —  OTP de usuário (5 díg) + auditoria
-- OTP p/ autorizar troca de senha/e-mail/telefone (envio WhatsApp/e-mail) e log
-- de auditoria das ações sensíveis de credenciais.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_auth_code (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  purpose         text NOT NULL,   -- password_change | email_change | phone_change
  channel         text,            -- whatsapp | email
  code_hash       text NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  used_at         timestamptz,
  expires_at      timestamptz NOT NULL,
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_auth_code_user ON user_auth_code (user_id, purpose, created_at DESC);
ALTER TABLE user_auth_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_auth_code FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_auth_code_rls ON user_auth_code;
CREATE POLICY user_auth_code_rls ON user_auth_code FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS credential_audit (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid,                     -- alvo da mudança
  action              text NOT NULL,            -- password_change | email_change | phone_change
  via                 text NOT NULL,            -- self | code | master
  performed_by_user_id uuid,
  ticket_id           uuid,
  detail              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_credential_audit_org ON credential_audit (organization_id, created_at DESC);
ALTER TABLE credential_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credential_audit_rls ON credential_audit;
CREATE POLICY credential_audit_rls ON credential_audit FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
