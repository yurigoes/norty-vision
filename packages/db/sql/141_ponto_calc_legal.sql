-- ==============================================================================
-- 141_ponto_calc_legal.sql  (idempotente)
-- Ponto — refino de cálculo legal:
--  • hora noturna REDUZIDA (CLT art. 73 §1º): 52min30s de relógio = 1h ficta.
--  • DSR formal: perda do descanso semanal remunerado em semana com falta
--    injustificada. Toggles por empresa (algumas CCTs dispensam/alteram).
-- ==============================================================================
ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS night_reduced_hour boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dsr_loss_enabled   boolean NOT NULL DEFAULT true;
