-- ==============================================================================
-- 086_exam_payments.sql  (idempotente)
--
-- Recebimento de EXAMES (consulta) no check-in. Caixa de exames é separado do
-- caixa de vendas (óculos/lentes): mesma abertura/fechamento, totais e relatórios
-- separados por origem; juntam só no fechamento do PDV.
--
--   exam_payments        — 1 recebimento por atendimento (paciente que compareceu)
--   exam_payment_lines   — split de pagamento (dinheiro/pix/cartão), NUNCA crediário
--
-- Desconto exige autorização de admin (código 4 dígitos no WhatsApp) — reaproveita
-- credit_auth_codes com purpose 'exam_discount' (installment_id nulo).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS exam_payments (
  id                    uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id              uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  appointment_id        uuid REFERENCES appointments(id) ON DELETE SET NULL,
  customer_id           uuid REFERENCES customers(id) ON DELETE SET NULL,
  professional_id       uuid REFERENCES professionals(id) ON DELETE SET NULL,
  amount_cents          bigint NOT NULL DEFAULT 0,    -- total recebido (com desconto)
  original_cents        bigint NOT NULL DEFAULT 0,    -- preço cheio (antes do desconto)
  discount_cents        bigint NOT NULL DEFAULT 0,
  discount_authorized_by uuid,                        -- membership do admin que aprovou
  discount_auth_at      timestamptz,
  status                text NOT NULL DEFAULT 'paid'
                        CHECK (status IN ('paid','canceled')),
  notes                 text,
  created_by            uuid,                          -- membership do operador
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_payments_store_idx ON exam_payments (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exam_payments_org_idx   ON exam_payments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exam_payments_appt_idx  ON exam_payments (appointment_id);
ALTER TABLE exam_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_payments_rls ON exam_payments;
CREATE POLICY exam_payments_rls ON exam_payments FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS exam_payment_lines (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_payment_id uuid NOT NULL REFERENCES exam_payments(id) ON DELETE CASCADE,
  method          text NOT NULL CHECK (method IN ('cash','pix','card')),  -- sem crediário
  provider        text,                 -- mp | maquininha (p/ pix e cartão)
  card_type       text,                 -- credit | debit
  amount_cents    bigint NOT NULL,
  status          text NOT NULL DEFAULT 'paid'
                  CHECK (status IN ('paid','pending','expired','canceled')),
  mp_payment_id   text,
  mp_qr_code      text,
  mp_qr_base64    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_payment_lines_parent_idx ON exam_payment_lines (exam_payment_id);
ALTER TABLE exam_payment_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_payment_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exam_payment_lines_rls ON exam_payment_lines;
CREATE POLICY exam_payment_lines_rls ON exam_payment_lines FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
