-- 192_production_size_grade.sql
-- Fase 3 — Grade/modelo fixo por pedido (gráfica).
-- O operador define a GRADE do pedido: uma lista de modelos, cada um com um
-- rótulo e os tamanhos permitidos. Ex.:
--   [ { "key": "camisa", "label": "Camisa Oficial", "sizes": ["PP","P","M","G","GG","XG"] },
--     { "key": "short",  "label": "Short",          "sizes": ["P","M","G","GG"] } ]
-- Com a grade montada, o cliente (e o operador) preenchem o roster ESCOLHENDO
-- o modelo e o tamanho de listas fixas — sem texto livre inconsistente.
-- NULL/[] = sem grade → comportamento antigo (tamanho texto livre).

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS size_grade jsonb;

-- Cada linha do roster passa a referenciar a qual modelo da grade ela pertence
-- (uma pessoa pode ter uma linha por modelo: camisa M + short G).
ALTER TABLE production_order_roster
  ADD COLUMN IF NOT EXISTS model_key text;
