-- ==============================================================================
-- 113_subscription_invoices.sql  (idempotente)
--
-- Mensalidades da ASSINATURA da empresa com o SaaS (não confundir com as
-- parcelas do crediário do cliente final). O master lança/marca como paga e
-- sobe a nota fiscal; a empresa vê as mensalidades pagas, baixa o recibo
-- (estilizado com a marca do dono do SaaS) e a NF.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competence       text NOT NULL,                      -- 'YYYY-MM' (mês de referência)
  amount_cents     bigint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','canceled')),
  due_date         date,
  paid_at          timestamptz,
  payment_method   text,
  nf_url           text,
  nf_uploaded_at   timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_invoices_org_idx ON subscription_invoices (organization_id, competence DESC);
CREATE INDEX IF NOT EXISTS subscription_invoices_status_idx ON subscription_invoices (status, due_date);

DROP TRIGGER IF EXISTS tg_subscription_invoices_updated_at ON subscription_invoices;
CREATE TRIGGER tg_subscription_invoices_updated_at BEFORE UPDATE ON subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_invoices_rls ON subscription_invoices;
CREATE POLICY subscription_invoices_rls ON subscription_invoices FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
