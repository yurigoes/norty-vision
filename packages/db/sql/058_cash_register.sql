-- ==============================================================================
-- 058_cash_register.sql
-- Caixa diário (PDV): abre/fecha turno por loja; no fechamento guarda os totais
-- por meio de pagamento e o valor conferido em dinheiro.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cash_registers (
  id                   uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id             uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at            timestamptz NOT NULL DEFAULT now(),
  opening_float_cents  bigint NOT NULL DEFAULT 0,     -- troco inicial
  closed_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at            timestamptz,
  closing_counted_cents bigint,                       -- dinheiro contado na gaveta
  expected_cash_cents  bigint,                         -- esperado em dinheiro (float + vendas dinheiro)
  totals               jsonb NOT NULL DEFAULT '{}',    -- {cash,pix,card,credit,other,total} no fechamento
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_registers_store_status_idx ON cash_registers (store_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS cash_registers_org_idx ON cash_registers (organization_id, opened_at DESC);
-- só um caixa aberto por loja
CREATE UNIQUE INDEX IF NOT EXISTS cash_registers_one_open_per_store
  ON cash_registers (store_id) WHERE status = 'open';

ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_registers_rls ON cash_registers;
CREATE POLICY cash_registers_rls ON cash_registers FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
