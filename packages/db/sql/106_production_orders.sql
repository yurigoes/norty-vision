-- ==============================================================================
-- 106_production_orders.sql  (idempotente)
--
-- Pedido de produção (ex.: uniformes sublimados). Fluxo:
--   novo → arte (aprovação) → costura → produção → separação → pronto(notifica)
--        → entrega(se delivery) → finalizado
-- + aprovação de arte (arquivos do cliente + arte do design, versionadas) e
--   seção Design (kanban por art_status + urgência do prazo).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS production_orders (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id) ON DELETE SET NULL,
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,
  short_code        text UNIQUE,
  contact_name      text NOT NULL,
  contact_phone     text,
  contact_email     text,
  status            text NOT NULL DEFAULT 'novo'
                      CHECK (status IN ('novo','arte','costura','producao','separacao','pronto','entrega','finalizado','cancelado')),
  art_status        text NOT NULL DEFAULT 'aguardando_arquivos'
                      CHECK (art_status IN ('aguardando_arquivos','arquivos_recebidos','em_producao','enviada','aprovada','reprovada')),
  delivery          boolean NOT NULL DEFAULT false,   -- true = vai entregar; false = cliente retira
  due_date          date,
  total_cents       bigint NOT NULL DEFAULT 0,
  down_payment_cents bigint NOT NULL DEFAULT 0,
  payment_status    text NOT NULL DEFAULT 'none' CHECK (payment_status IN ('none','partial','paid')),
  payment_method    text,
  needs_invoice     boolean NOT NULL DEFAULT false,   -- "pediu NF?" (fase NF)
  notes             text,
  seller_user_id    uuid,
  created_by_user_id uuid,
  ready_notified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_orders_org_status_idx ON production_orders (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS production_orders_org_art_idx ON production_orders (organization_id, art_status);

CREATE TABLE IF NOT EXISTS production_order_items (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  description       text NOT NULL,
  qty               int  NOT NULL DEFAULT 1,
  unit_price_cents  bigint NOT NULL DEFAULT 0,
  line_total_cents  bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_order_items_order_idx ON production_order_items (order_id);

CREATE TABLE IF NOT EXISTS production_order_files (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('client_asset','art')),  -- arquivo do cliente | arte do design
  url               text NOT NULL,
  name              text,
  version           int  NOT NULL DEFAULT 1,
  uploaded_by       text NOT NULL DEFAULT 'staff' CHECK (uploaded_by IN ('staff','customer')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_order_files_order_idx ON production_order_files (order_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS production_art_reviews (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  file_id           uuid REFERENCES production_order_files(id) ON DELETE SET NULL,
  decision          text NOT NULL CHECK (decision IN ('approved','rejected')),
  comment           text,
  reviewer          text NOT NULL DEFAULT 'customer' CHECK (reviewer IN ('customer','staff')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_art_reviews_order_idx ON production_art_reviews (order_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_production_orders_updated_at ON production_orders;
CREATE TRIGGER tg_production_orders_updated_at BEFORE UPDATE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_orders','production_order_items','production_order_files','production_art_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_rls ON %I FOR ALL USING (app.is_platform_admin() OR organization_id = app.current_org_id()) WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id())', t, t);
  END LOOP;
END $$;
