-- ==============================================================================
-- 105_quotes.sql  (idempotente)
--
-- Módulo ORÇAMENTOS (reutilizável por qualquer nicho): orçamento com itens,
-- gera PDF, envia por WhatsApp/e-mail (branded) e pode virar pedido/venda.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id) ON DELETE SET NULL,
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,
  short_code        text UNIQUE,
  contact_name      text NOT NULL,
  contact_phone     text,
  contact_email     text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','converted','expired')),
  notes             text,
  valid_until       date,
  discount_cents    int NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  pdf_url           text,
  seller_user_id    uuid,
  created_by_user_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_org_status_idx ON quotes (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS quote_items (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id          uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description       text NOT NULL,
  qty               int  NOT NULL DEFAULT 1,
  unit_price_cents  bigint NOT NULL DEFAULT 0,
  line_total_cents  bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_items_quote_idx ON quote_items (quote_id);

DROP TRIGGER IF EXISTS tg_quotes_updated_at ON quotes;
CREATE TRIGGER tg_quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotes_rls ON quotes;
CREATE POLICY quotes_rls ON quotes FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_items_rls ON quote_items;
CREATE POLICY quote_items_rls ON quote_items FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
