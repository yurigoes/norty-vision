-- ==============================================================================
-- 103_inventory.sql  (idempotente)
--
-- Gestão de estoque: estoque mínimo por produto + log de movimentações
-- (venda baixa, entrada/compra, ajuste manual). Alimenta:
--   - alerta interno (banner) de produtos abaixo do mínimo;
--   - relatórios: baixo estoque por produto e por grupo (categoria) + giro.
-- ==============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_stock_qty INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS stock_movements (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id           uuid REFERENCES stores(id) ON DELETE SET NULL,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('sale','purchase','adjustment','return')),
  qty                int  NOT NULL,                 -- negativo = saída, positivo = entrada
  qty_after          int,                           -- estoque resultante (snapshot)
  reason             text,
  reference_type     text,                          -- 'sale' | 'manual' | ...
  reference_id       uuid,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movements_org_product_idx
  ON stock_movements (organization_id, product_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_stock_movements_noop ON stock_movements;

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_movements_rls ON stock_movements;
CREATE POLICY stock_movements_rls ON stock_movements FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
