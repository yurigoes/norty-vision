-- ==============================================================================
-- 040_supplier_settlements.sql
-- Repasses/fechamentos a fornecedores (medico = repasse por exame/pedido;
-- laboratorio = custo da lente). Cada fechamento agrupa itens de um periodo,
-- registra o pagamento (forma, id, comprovante) e gera recibo branded.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS supplier_settlements (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id        uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

  period_start       date,
  period_end         date,
  total_cents        bigint NOT NULL DEFAULT 0,

  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at            timestamptz,
  payment_method     text,
  payment_id         text,
  proof_url          text,
  notes              text,

  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_settlements_idx ON supplier_settlements (organization_id, supplier_id, status);

DROP TRIGGER IF EXISTS tg_supplier_settlements_updated_at ON supplier_settlements;
CREATE TRIGGER tg_supplier_settlements_updated_at BEFORE UPDATE ON supplier_settlements
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE supplier_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_settlements_rls ON supplier_settlements;
CREATE POLICY supplier_settlements_rls ON supplier_settlements FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settlement_items (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  settlement_id   uuid NOT NULL REFERENCES supplier_settlements(id) ON DELETE CASCADE,

  source_type     text NOT NULL CHECK (source_type IN ('lens_lab','lens_doctor','manual')),
  source_id       uuid,                       -- lens_order id (ou null em manual)
  description     text NOT NULL,
  amount_cents    bigint NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_items_settlement_idx ON settlement_items (settlement_id);
CREATE INDEX IF NOT EXISTS settlement_items_source_idx ON settlement_items (source_type, source_id);

ALTER TABLE settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_items_rls ON settlement_items;
CREATE POLICY settlement_items_rls ON settlement_items FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE supplier_settlements IS
  'Fechamentos/repasses a fornecedores (medico/lab) com pagamento e recibo.';
COMMENT ON TABLE settlement_items IS
  'Itens do fechamento: custo de lente (lens_lab), repasse de pedido (lens_doctor) ou manual.';
