-- ==============================================================================
-- 030_dunning.sql
-- Cobranca automatizada de crediario:
--   dunning_rules  — regras por org (dias apos vencimento, canal, template)
--   dunning_events — log de cada cobranca disparada (timeline WhatsApp/email)
--
-- O scheduler (SchedulerService) roda de hora em hora e, pra cada parcela
-- vencida, aplica a regra cujo days_after_due bate, desde que ainda nao
-- tenha disparado essa regra pra essa parcela (idempotente).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- dunning_rules
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dunning_rules (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            text NOT NULL,
  days_after_due  int NOT NULL,             -- 1, 3, 7, 15 ... (negativo = lembrete antes)
  channel         text NOT NULL DEFAULT 'whatsapp'
                  CHECK (channel IN ('whatsapp','email','both')),
  -- template com placeholders {{nome}} {{parcela}} {{valor}} {{vencimento}} {{dias}}
  template_text   text NOT NULL,

  is_active       boolean NOT NULL DEFAULT true,
  display_order   int NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, days_after_due)
);

CREATE INDEX IF NOT EXISTS dunning_rules_org_idx
  ON dunning_rules (organization_id) WHERE is_active;

DROP TRIGGER IF EXISTS tg_dunning_rules_updated_at ON dunning_rules;
CREATE TRIGGER tg_dunning_rules_updated_at BEFORE UPDATE ON dunning_rules
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE dunning_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dunning_rules_rls ON dunning_rules;
CREATE POLICY dunning_rules_rls ON dunning_rules FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- dunning_events — timeline de cobrancas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dunning_events (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
  installment_id  uuid NOT NULL REFERENCES credit_installments(id) ON DELETE CASCADE,
  rule_id         uuid REFERENCES dunning_rules(id) ON DELETE SET NULL,

  days_overdue    int NOT NULL,
  channel         text NOT NULL,
  message         text,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent','failed','skipped')),
  detail          text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dunning_events_acct_idx
  ON dunning_events (credit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dunning_events_inst_rule_idx
  ON dunning_events (installment_id, rule_id);
CREATE INDEX IF NOT EXISTS dunning_events_org_idx
  ON dunning_events (organization_id, created_at DESC);

ALTER TABLE dunning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dunning_events_read ON dunning_events;
CREATE POLICY dunning_events_read ON dunning_events FOR SELECT
  USING (app.is_platform_admin() OR organization_id = app.current_org_id());
DROP POLICY IF EXISTS dunning_events_write ON dunning_events;
CREATE POLICY dunning_events_write ON dunning_events FOR INSERT
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE dunning_rules IS
  'Regras de cobranca por org. days_after_due negativo = lembrete antes do vencimento.';
COMMENT ON TABLE dunning_events IS
  'Timeline imutavel de cobrancas disparadas. Idempotencia: 1 evento por (installment, rule).';
