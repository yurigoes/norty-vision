-- ==============================================================================
-- 069_plan_extra_highlights.sql
-- Planos por módulo: `features` passa a guardar as CHAVES de módulo selecionadas
-- (checkbox) que liberam o acesso automaticamente. `extra_highlights` guarda os
-- destaques de marketing (ex.: "Suporte prioritário") só pra exibição.
-- ==============================================================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS extra_highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN plans.features IS 'Chaves de módulo liberadas pelo plano (gating do cadeado).';
COMMENT ON COLUMN plans.extra_highlights IS 'Destaques de marketing exibidos no plano (texto livre).';
