-- ==============================================================================
-- 104_stock_by_store.sql  (idempotente)
--
-- Estoque por LOJA (Opção A): o saldo passa a viver em product_store_stock
-- (produto × loja). products.stock_qty vira o TOTAL calculado (soma das lojas) —
-- mantido em sincronia pelo backend. O mínimo continua GLOBAL (products.min_stock_qty).
--
-- Seed: joga o estoque atual (>0) de cada produto na loja MAIS ANTIGA da empresa.
-- Empresas com 1 loja não percebem diferença.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS product_store_stock (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  qty              int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, store_id)
);

CREATE INDEX IF NOT EXISTS product_store_stock_org_store_idx ON product_store_stock (organization_id, store_id);

DROP TRIGGER IF EXISTS tg_product_store_stock_updated_at ON product_store_stock;
CREATE TRIGGER tg_product_store_stock_updated_at BEFORE UPDATE ON product_store_stock
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE product_store_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_store_stock FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_store_stock_rls ON product_store_stock;
CREATE POLICY product_store_stock_rls ON product_store_stock FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Seed do estoque atual na loja mais antiga da empresa (uma vez; ON CONFLICT evita duplicar)
INSERT INTO product_store_stock (organization_id, product_id, store_id, qty)
SELECT p.organization_id, p.id,
       (SELECT st.id FROM stores st WHERE st.organization_id = p.organization_id ORDER BY st.created_at ASC LIMIT 1),
       p.stock_qty
FROM products p
WHERE p.deleted_at IS NULL AND p.stock_qty > 0
  AND EXISTS (SELECT 1 FROM stores st2 WHERE st2.organization_id = p.organization_id)
ON CONFLICT (product_id, store_id) DO NOTHING;
