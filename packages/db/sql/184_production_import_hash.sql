-- ==============================================================================
-- 184_production_import_hash.sql  (idempotente)
--
-- Hash de dedupe pra importação em massa de pedidos de produção (xlsx legado).
-- A 2a execução do mesmo arquivo NÃO duplica linhas: o parser monta o hash
-- de (contato + fechamento + valor) e pula se já existe.
-- ==============================================================================

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS import_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_orders_import_hash
  ON production_orders (organization_id, import_hash)
  WHERE import_hash IS NOT NULL;
