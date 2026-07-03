-- ==============================================================================
-- 156_plan_niche.sql  (idempotente)  —  PLANOS: mensalidade do sistema por nicho
--
-- Cada plano pode ser amarrado a um nicho (organizations.niche). A empresa vê
-- apenas a mensalidade do seu nicho (gráfica = um valor, ótica = outro). Planos
-- com niche NULL valem para todos (genéricos).
-- ==============================================================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS niche text;
