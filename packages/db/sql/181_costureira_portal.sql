-- ==============================================================================
-- 181_costureira_portal.sql  (idempotente)
--
-- Portal da costureira (nicho gráfica). Costureira é um Supplier reutilizando
-- o supplier-portal já existente. Adições:
--
-- 1) supplier.price_per_piece_cents : valor único por peça que ela recebe.
--    Multiplicado pelo total de peças do roster do pedido ao marcar "pronto".
-- 2) production_order.assigned_supplier_id : a costureira responsável.
-- 3) production_order.produced_at : timestamp do "pedido pronto" pela costureira.
-- 4) production_order.production_price_cents : SNAPSHOT do valor que ela vai
--    receber por essa OS — congelado no momento do "pronto" pra histórico não
--    quebrar se o price_per_piece_cents mudar depois.
-- ==============================================================================

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS price_per_piece_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS assigned_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS produced_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_price_cents bigint;

CREATE INDEX IF NOT EXISTS idx_production_orders_assigned_supplier
  ON production_orders (organization_id, assigned_supplier_id, status)
  WHERE assigned_supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_orders_produced_at
  ON production_orders (organization_id, assigned_supplier_id, produced_at)
  WHERE produced_at IS NOT NULL;
