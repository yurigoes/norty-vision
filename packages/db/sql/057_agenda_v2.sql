-- ==============================================================================
-- 057_agenda_v2.sql
-- Agenda v2:
--  - preço do exame por loja (aparece nas notificações de agendamento)
--  - customer_followups: pendências (ex.: cliente cancelou pelo WhatsApp/portal,
--    recepção precisa entrar em contato pra remarcar depois)
-- ==============================================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS exam_price_cents int NOT NULL DEFAULT 14000;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS exam_payment_note text NOT NULL DEFAULT 'no Pix ou dinheiro';

CREATE TABLE IF NOT EXISTS customer_followups (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'appointment_canceled'
                  CHECK (kind IN ('appointment_canceled','reschedule_requested','other')),
  ref_type        text,                       -- 'appointment'
  ref_id          uuid,                       -- appointment.id
  note            text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_followups_org_status_idx
  ON customer_followups (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_followups_customer_idx
  ON customer_followups (customer_id, created_at DESC);

ALTER TABLE customer_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_followups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_followups_rls ON customer_followups;
CREATE POLICY customer_followups_rls ON customer_followups FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
