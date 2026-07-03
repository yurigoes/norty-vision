-- ==============================================================================
-- 054_sale_payments.sql
-- Pagamentos POR VENDA (suporta split: vários meios numa mesma venda).
-- Ex.: total 200 = 100 cartão + 50 pix + 50 dinheiro.
--
-- - method: meio do pagamento
-- - provider: 'mp' quando o Pix foi gerado no Mercado Pago (senão null = manual/presencial)
-- - status: 'paid' (dinheiro/cartão presencial/pix manual) ou 'pending' (pix MP
--   aguardando confirmação do webhook) -> 'paid' quando confirmar
-- ==============================================================================

CREATE TABLE IF NOT EXISTS sale_payments (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  sale_id         uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method          text NOT NULL CHECK (method IN ('cash','pix','card','credit')),
  provider        text,                       -- 'mp' = Mercado Pago; null = manual/presencial
  amount_cents    bigint NOT NULL,
  status          text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','failed','canceled')),
  mp_payment_id   text,
  mp_qr_code      text,                        -- copia-e-cola do Pix (quando MP)
  mp_qr_base64    text,                        -- imagem do QR (quando MP)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON sale_payments (sale_id);
CREATE INDEX IF NOT EXISTS sale_payments_org_idx ON sale_payments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_payments_mp_idx ON sale_payments (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_payments_rls ON sale_payments;
CREATE POLICY sale_payments_rls ON sale_payments FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
