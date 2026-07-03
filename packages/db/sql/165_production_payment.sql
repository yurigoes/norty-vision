-- ==============================================================================
-- 165_production_payment.sql  (idempotente)  —  trilha de pagamento do pedido
-- Livro-caixa do pedido de produção: entrada/saldo/estorno, com provedor (MP /
-- InfinitePay / maquininha), status e comprovante. Base p/ "gerar pagamento" da
-- entrada e p/ o estorno no cancelamento.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS production_payment (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id            uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  kind                text NOT NULL DEFAULT 'entrada',   -- entrada | saldo | estorno
  method              text,                              -- card_machine | pix_machine | pix | card | cash
  provider            text,                              -- mp | infinitepay | manual
  amount_cents        bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending',   -- pending | paid | failed | refunded
  mp_payment_id       text,
  infinitepay_link_id uuid,
  link                text,
  proof_url           text,
  notes               text,
  created_by          uuid,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_production_payment_order ON production_payment (order_id, created_at);
CREATE INDEX IF NOT EXISTS ix_production_payment_org ON production_payment (organization_id, status);
CREATE INDEX IF NOT EXISTS ix_production_payment_mp ON production_payment (mp_payment_id);

ALTER TABLE production_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_payment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_payment_rls ON production_payment;
CREATE POLICY production_payment_rls ON production_payment FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
