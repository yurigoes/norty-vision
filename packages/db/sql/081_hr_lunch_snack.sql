-- ==============================================================================
-- 081_hr_lunch_snack.sql  (idempotente)
--
-- Escala com almoço por HORÁRIO FIXO + regra de lanche na hora extra.
--   - work_shifts.lunch_start / lunch_end: horário fixo do almoço por dia (HH:mm).
--   - hr_settings.snack_threshold_minutes: minutos de hora extra que dão direito
--     ao lanche (padrão 120 = 2h).
--   - hr_settings.snack_minutes: duração do lanche (padrão 15 min).
-- Batidas do dia: in · break_out (saída almoço) · break_in (volta) ·
--   snack_out · snack_in (lanche, se hora extra) · out.
-- ==============================================================================

ALTER TABLE work_shifts
  ADD COLUMN IF NOT EXISTS lunch_start text,
  ADD COLUMN IF NOT EXISTS lunch_end   text;

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS snack_threshold_minutes int NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS snack_minutes           int NOT NULL DEFAULT 15;
