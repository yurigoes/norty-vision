-- ==============================================================================
-- 051_membership_seller.sql
-- Marca quais membros são "vendedores". Só vendedores aparecem no PDV, no
-- dashboard de vendas e em comissões. Default false.
-- ==============================================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS is_seller boolean NOT NULL DEFAULT false;

-- por padrão, quem já tem % de comissão definida vira vendedor (backfill)
UPDATE memberships SET is_seller = true WHERE commission_pct IS NOT NULL;
