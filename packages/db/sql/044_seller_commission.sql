-- ==============================================================================
-- 044_seller_commission.sql
-- Vendedor atribuido na venda (separado de quem operou o PDV) + comissao por
-- vendedor (no membership da org). Base pro dashboard de vendas e comissoes.
-- ==============================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_seller_idx ON sales (organization_id, seller_user_id, created_at);

-- comissao do vendedor (% sobre o total) por membership. NULL = sem comissao.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2);

COMMENT ON COLUMN sales.seller_user_id IS
  'Vendedor a quem a venda e atribuida (comissao). Pode diferir do operador logado.';
COMMENT ON COLUMN memberships.commission_pct IS
  'Percentual de comissao do vendedor nessa org (sobre o total da venda).';
