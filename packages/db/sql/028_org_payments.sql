-- ==============================================================================
-- 028_org_payments.sql
-- Integracoes de pagamento POR ORGANIZACAO (separado do MP do master).
--
--   organization_integrations — credenciais de gateway por org (Mercado Pago).
--                               Cada empresa conecta a propria conta MP pra
--                               cobrar seus clientes finais.
--   payment_attempts          — tracking de tentativas de pagamento de parcela
--                               (Pix, cartao recorrente, cartao avulso) com
--                               retry e motivo de erro.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- organization_integrations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_integrations (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  provider        text NOT NULL,             -- 'mercadopago'
  label           text,

  -- credenciais (texto; RLS protege; futuro: cifrar em repouso)
  access_token    text,                      -- APP_USR-... (production) ou TEST-...
  public_key      text,
  webhook_secret  text,

  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'disabled'
                  CHECK (status IN ('active','disabled','error')),
  last_ping_at    timestamptz,
  last_ping_status text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS org_integrations_org_idx
  ON organization_integrations (organization_id);

DROP TRIGGER IF EXISTS tg_org_integrations_updated_at ON organization_integrations;
CREATE TRIGGER tg_org_integrations_updated_at BEFORE UPDATE ON organization_integrations
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_integrations_rls ON organization_integrations;
CREATE POLICY org_integrations_rls ON organization_integrations FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- payment_attempts — tracking de tentativas (retry de cartao)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_attempts (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  installment_id  uuid NOT NULL REFERENCES credit_installments(id) ON DELETE CASCADE,

  method          text NOT NULL CHECK (method IN ('pix','card_recurring','card_single','in_person')),
  amount_cents    bigint NOT NULL,
  attempt_number  int NOT NULL DEFAULT 1,

  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','failed','expired','cancelled')),

  mp_payment_id   text,
  mp_status_detail text,                      -- ex: 'cc_rejected_insufficient_amount'
  error_message   text,

  -- proxima tentativa agendada (retry)
  next_retry_at   timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_attempts_inst_idx
  ON payment_attempts (installment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_retry_idx
  ON payment_attempts (next_retry_at) WHERE status = 'rejected' AND next_retry_at IS NOT NULL;

DROP TRIGGER IF EXISTS tg_payment_attempts_updated_at ON payment_attempts;
CREATE TRIGGER tg_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_attempts_rls ON payment_attempts;
CREATE POLICY payment_attempts_rls ON payment_attempts FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE organization_integrations IS
  'Gateway de pagamento por org (Mercado Pago da propria empresa). Separado do MP do master que cobra assinaturas da plataforma.';
COMMENT ON TABLE payment_attempts IS
  'Tentativas de pagamento de parcela. Retry de cartao recorrente com next_retry_at.';
