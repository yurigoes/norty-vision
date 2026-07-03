-- ==============================================================================
-- 170_historical_sales.sql  (idempotente)  —  VENDAS HISTÓRICAS (importação)
-- Vendas antigas (item a item) importadas de relatórios do sistema legado. NÃO
-- mexem em estoque, caixa, fiscal nem comissões — servem só p/ controle/relatório.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS historical_sale_item (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id         uuid,
  legacy_code      text,                       -- código do produto no sistema antigo
  sale_date        date NOT NULL,
  product_name     text NOT NULL,
  qty              numeric(10,2) NOT NULL DEFAULT 1,
  unit_price_cents bigint NOT NULL DEFAULT 0,
  discount_cents   bigint NOT NULL DEFAULT 0,
  total_cents      bigint NOT NULL DEFAULT 0,
  source           text,                        -- ex.: "pdf-venda-produtos"
  import_batch_id  uuid,                        -- p/ desfazer um lote
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hist_sale_org_date ON historical_sale_item (organization_id, sale_date);
CREATE INDEX IF NOT EXISTS ix_hist_sale_batch ON historical_sale_item (organization_id, import_batch_id);
CREATE INDEX IF NOT EXISTS ix_hist_sale_name ON historical_sale_item (organization_id, product_name);
ALTER TABLE historical_sale_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE historical_sale_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS historical_sale_item_rls ON historical_sale_item;
CREATE POLICY historical_sale_item_rls ON historical_sale_item FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
