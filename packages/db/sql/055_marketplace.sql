-- ==============================================================================
-- 055_marketplace.sql
-- Catálogo / vitrine online (MVP).
--
-- - stores.catalog_enabled : liga a vitrine pública da loja (/loja/{slug})
-- - stores.catalog_headline: chamada de topo da vitrine (opcional)
-- - stores.catalog_whatsapp: número que recebe os pedidos/leads (fallback: instância da org)
-- - products.show_in_catalog: produto aparece na vitrine (default true)
-- - catalog_leads          : interesse/pedido enviado pelo cliente na vitrine
-- ==============================================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS catalog_enabled  boolean NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS catalog_headline text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS catalog_whatsapp text;

ALTER TABLE products ADD COLUMN IF NOT EXISTS show_in_catalog boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS catalog_leads (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_name   text NOT NULL,
  customer_phone  text NOT NULL,
  message         text,
  items           jsonb NOT NULL DEFAULT '[]',   -- [{productId,name,qty,unitPriceCents}]
  total_cents     bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_leads_org_idx ON catalog_leads (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_leads_store_idx ON catalog_leads (store_id, created_at DESC);

ALTER TABLE catalog_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_leads_rls ON catalog_leads;
CREATE POLICY catalog_leads_rls ON catalog_leads FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
