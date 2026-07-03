-- ==============================================================================
-- 064_commission_payouts.sql
-- Pagamento de comissões a vendedores (espelha o repasse a fornecedor):
-- registra período, vendas, base de faturamento, % e valor da comissão paga,
-- forma de pagamento, id e comprovante (arquivo). Gera recibo branded.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS commission_payouts (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seller_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  period_start       date,
  period_end         date,
  sales_count        int NOT NULL DEFAULT 0,
  base_cents         bigint NOT NULL DEFAULT 0,   -- faturamento base do período
  commission_pct     numeric(5,2),
  total_cents        bigint NOT NULL DEFAULT 0,   -- comissão paga

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

CREATE INDEX IF NOT EXISTS commission_payouts_idx ON commission_payouts (organization_id, seller_user_id, status);

DROP TRIGGER IF EXISTS tg_commission_payouts_updated_at ON commission_payouts;
CREATE TRIGGER tg_commission_payouts_updated_at BEFORE UPDATE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_payouts_rls ON commission_payouts;
CREATE POLICY commission_payouts_rls ON commission_payouts FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE commission_payouts IS
  'Pagamentos de comissão a vendedores: período, base, %, valor, forma, comprovante e recibo.';
