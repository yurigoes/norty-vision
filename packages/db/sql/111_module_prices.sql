-- ==============================================================================
-- 111_module_prices.sql  (idempotente)
--
-- Preço à la carte de cada módulo (global da plataforma, definido pelo master).
-- Usado na página do módulo bloqueado pra oferecer a compra avulsa. Tabela de
-- referência global (sem organization_id) — não leva RLS por org.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS module_prices (
  module_key   text PRIMARY KEY,
  price_cents  integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
