-- ==============================================================================
-- 109_production_roster_batch.sql  (idempotente)
--
-- Pedido de produção — complementos do nicho esportivo:
--   1) Ficha técnica (roster): jogador × número × tamanho × quantidade.
--   2) Lote (batch): agrupa vários pedidos pra produzir/avançar juntos.
-- ==============================================================================

-- ---- Lote de produção -------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_batches (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id) ON DELETE SET NULL,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'aberto'
                      CHECK (status IN ('aberto','producao','concluido','cancelado')),
  notes             text,
  created_by_user_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_batches_org_idx ON production_batches (organization_id, status, created_at DESC);

-- vínculo do pedido ao lote (opcional)
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS production_orders_batch_idx ON production_orders (batch_id);

-- ---- Ficha técnica (roster de jogadores) ------------------------------------
CREATE TABLE IF NOT EXISTS production_order_roster (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  player_name       text NOT NULL,
  number            text,           -- número da camisa (texto: pode ter 0 à esquerda)
  size              text,           -- PP/P/M/G/GG/XG ou numérico
  qty               int  NOT NULL DEFAULT 1,
  notes             text,
  position          int  NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_order_roster_order_idx ON production_order_roster (order_id, position);

DROP TRIGGER IF EXISTS tg_production_batches_updated_at ON production_batches;
CREATE TRIGGER tg_production_batches_updated_at BEFORE UPDATE ON production_batches
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_batches','production_order_roster'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_rls ON %I FOR ALL USING (app.is_platform_admin() OR organization_id = app.current_org_id()) WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id())', t, t);
  END LOOP;
END $$;
