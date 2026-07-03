-- 194_submodule_features.sql
-- Extensão da Fase 2 — sub-módulos genéricos (por empresa, controle do master).
-- A Fase 2 ligava/desligava abas só da Produção (production_features). Aqui
-- generalizamos: um único mapa por empresa, chaveado por "<modulo>.<sub>", que
-- vale pra qualquer módulo (producao, atendimento, financeiro, crm…).
-- DEFAULT-ON: só entram as chaves DESLIGADAS (false).
--
-- Migra o que já estava em production_features (chaves "soltas") pro mapa novo
-- com o prefixo "producao." — ninguém perde a config feita na Fase 2.

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS submodule_features jsonb;

UPDATE call_center_settings
SET submodule_features = (
  SELECT jsonb_object_agg('producao.' || key, value)
  FROM jsonb_each(production_features)
)
WHERE production_features IS NOT NULL
  AND production_features <> '{}'::jsonb
  AND submodule_features IS NULL;
