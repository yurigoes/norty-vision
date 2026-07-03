-- ==============================================================================
-- 166_prodorder_discount.sql  (idempotente)  —  desconto no pedido de produção
-- Desconto em R$ no total do pedido, liberado por admin/gerente/supervisor via
-- código de autorização (guarda o nome de quem liberou).
-- ==============================================================================

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS discount_authorized_by text;
