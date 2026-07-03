-- ==============================================================================
-- 164_prodorder_nf_fields.sql  (idempotente)  —  NF gerada no pedido de produção
-- Guarda o nº/chave da NF emitida e quem autorizou (quando gerada sem pagamento
-- total, via código de autorização de admin/gerente/supervisor).
-- ==============================================================================

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS nf_key text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS nf_number text;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS nf_authorized_by text;
