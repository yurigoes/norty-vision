-- ==============================================================================
-- 185_relax_checks_costureira_delivery.sql  (idempotente)
--
-- Relaxa 2 CHECK constraints que estavam bloqueando:
-- 1) suppliers.type não aceitava 'costureira' (a 181_costureira_portal
--    adicionou a coluna price_per_piece_cents mas esqueceu de alterar o
--    CHECK criado em 037_suppliers.sql).
-- 2) production_order_files.kind não aceitava 'delivery' (importação do
--    .xlsx legado anexa foto de saída como kind='delivery').
-- ==============================================================================

-- suppliers.type: adiciona "costureira"
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_type_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_type_check
  CHECK (type IN ('medico','laboratorio','costureira','outro'));

-- production_order_files.kind: adiciona "delivery" (foto da entrega/saída)
ALTER TABLE production_order_files DROP CONSTRAINT IF EXISTS production_order_files_kind_check;
ALTER TABLE production_order_files ADD CONSTRAINT production_order_files_kind_check
  CHECK (kind IN ('client_asset','art','delivery'));
