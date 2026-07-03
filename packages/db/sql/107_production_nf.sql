-- ==============================================================================
-- 107_production_nf.sql  (idempotente)
--
-- Nota fiscal sob demanda no pedido de produção. Se needs_invoice = true, o
-- pedido cai na aba "Notas fiscais" pendente até o upload da NF, e exige os
-- dados fiscais completos do cliente (CPF, endereço, nascimento).
-- ==============================================================================

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS nf_url text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS nf_issued_at timestamptz;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS fiscal_cpf text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS fiscal_address text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS fiscal_birth_date date;

CREATE INDEX IF NOT EXISTS production_orders_nf_pending_idx
  ON production_orders (organization_id)
  WHERE needs_invoice = true AND nf_url IS NULL;
