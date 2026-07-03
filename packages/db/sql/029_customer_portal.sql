-- ==============================================================================
-- 029_customer_portal.sql
-- Painel do cliente final (crediario):
--   - login por CPF + 2FA WhatsApp (otp_codes) OU senha (argon)
--   - editar contato/endereco + foto de perfil
--   - pedir limite de crediario (KYC: identidade frente/verso, comprovante
--     de residencia, renda, selfie segurando identidade) -> pendente
--
-- Identidade do portal = credit_account (org + documento). password_hash e
-- sessao ficam na conta de crediario. customer (por loja) guarda contato/foto.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- customers: campos extras (perfil + endereco detalhado + renda)
-- ------------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_complement text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS income_cents bigint;

-- ------------------------------------------------------------------------------
-- credit_accounts: auth do portal
-- ------------------------------------------------------------------------------
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS portal_last_login_at timestamptz;

-- ------------------------------------------------------------------------------
-- customer_sessions — sessao do portal (cookie httpOnly)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_sessions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  ip_address      inet,
  user_agent      text,
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_sessions_acct_idx ON customer_sessions (credit_account_id);

-- RLS: aberto pro service (resolvido com is_platform_admin no runWithContext)
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_sessions_rls ON customer_sessions;
CREATE POLICY customer_sessions_rls ON customer_sessions FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- customer_documents — uploads do cliente (KYC + avatar)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_documents (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_account_id uuid REFERENCES credit_accounts(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,

  doc_type        text NOT NULL CHECK (doc_type IN (
    'avatar','id_front','id_back','proof_residence','selfie_holding_id','income_proof','other'
  )),
  file_url        text NOT NULL,
  status          text NOT NULL DEFAULT 'uploaded'
                  CHECK (status IN ('uploaded','approved','rejected')),
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_documents_acct_idx ON customer_documents (credit_account_id);
CREATE INDEX IF NOT EXISTS customer_documents_type_idx ON customer_documents (organization_id, doc_type);

DROP TRIGGER IF EXISTS tg_customer_documents_updated_at ON customer_documents;
CREATE TRIGGER tg_customer_documents_updated_at BEFORE UPDATE ON customer_documents
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_documents_rls ON customer_documents;
CREATE POLICY customer_documents_rls ON customer_documents FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- credit_applications — pedido de crediario do cliente (KYC) -> aprovacao admin
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_applications (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,

  income_cents    bigint,
  requested_limit_cents bigint NOT NULL,

  -- snapshot dos documentos no momento do pedido (ids de customer_documents)
  document_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,

  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','more_info')),
  approved_limit_cents bigint,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_note     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_applications_pending_idx
  ON credit_applications (organization_id, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS credit_applications_acct_idx ON credit_applications (credit_account_id);

DROP TRIGGER IF EXISTS tg_credit_applications_updated_at ON credit_applications;
CREATE TRIGGER tg_credit_applications_updated_at BEFORE UPDATE ON credit_applications
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_applications_rls ON credit_applications;
CREATE POLICY credit_applications_rls ON credit_applications FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE customer_sessions IS
  'Sessao do portal do cliente (cookie httpOnly). Identidade = credit_account.';
COMMENT ON TABLE credit_applications IS
  'Pedido de crediario do cliente com KYC (renda + documentos). Pendente ate admin/owner aprovar.';
