-- ==============================================================================
-- 090_inbox_orders.sql  (idempotente)
--
-- "Vender pelo chat": ordem de cobrança gerada dentro de uma conversa do
-- atendimento. Pix (copia-e-cola via MP) ou cartão (link MP). Acompanha o
-- pagamento e dispara confirmação ao cliente + nota interna ao operador.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inbox_orders (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,
  order_number      text NOT NULL,                  -- nº amigável (OP-...)
  items             jsonb NOT NULL DEFAULT '[]',     -- [{name, qty, unitCents}]
  total_cents       bigint NOT NULL DEFAULT 0,
  method            text NOT NULL CHECK (method IN ('pix','card')),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','canceled','expired')),
  mp_payment_id     text,
  mp_qr_code        text,                            -- copia-e-cola Pix
  mp_qr_base64      text,
  mp_init_point     text,                            -- link checkout (cartão)
  created_by_membership_id uuid,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_orders_conv_idx ON inbox_orders (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_orders_org_status_idx ON inbox_orders (organization_id, status);

DROP TRIGGER IF EXISTS tg_inbox_orders_updated_at ON inbox_orders;
CREATE TRIGGER tg_inbox_orders_updated_at BEFORE UPDATE ON inbox_orders
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE inbox_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_orders_rls ON inbox_orders;
CREATE POLICY inbox_orders_rls ON inbox_orders FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
