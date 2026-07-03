-- ==============================================================================
-- 110_production_fabric.sql  (idempotente)
--
-- Consumo de tecido/insumos do estoque pelo pedido de produção. Cada pedido
-- pode listar os tecidos (produtos com controle de estoque) e a quantidade
-- consumida. Ao entrar em "produção", a quantidade é baixada do estoque da loja
-- do pedido (uma única vez — guardado por fabric_consumed_at).
-- ==============================================================================

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS fabric_consumed_at timestamptz;

CREATE TABLE IF NOT EXISTS production_order_fabric (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty               int  NOT NULL DEFAULT 0,   -- unidades de estoque (ex.: metros)
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_order_fabric_order_idx ON production_order_fabric (order_id);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE production_order_fabric ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE production_order_fabric FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS production_order_fabric_rls ON production_order_fabric';
  EXECUTE 'CREATE POLICY production_order_fabric_rls ON production_order_fabric FOR ALL USING (app.is_platform_admin() OR organization_id = app.current_org_id()) WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id())';
END $$;
