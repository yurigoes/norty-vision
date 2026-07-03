-- ==============================================================================
-- 068_hr_escala_duploaceite.sql
-- RH 3ª leva:
--   - work_shifts: intervalo (break_minutes) pra escala mensal calcular horas.
--   - hr_requests: duplo aceite na troca de horário (o colega B precisa aceitar
--     antes da gestão aprovar). colleague_decision: pending/accepted/rejected.
-- ==============================================================================

ALTER TABLE work_shifts ADD COLUMN IF NOT EXISTS break_minutes int NOT NULL DEFAULT 0;

ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS colleague_decision text NOT NULL DEFAULT 'na'
  CHECK (colleague_decision IN ('na','pending','accepted','rejected'));
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS colleague_decided_at timestamptz;

COMMENT ON COLUMN work_shifts.break_minutes IS 'Minutos de intervalo (almoço) descontados da jornada.';
COMMENT ON COLUMN hr_requests.colleague_decision IS 'Troca de horário: aceite do colega B (na quando não se aplica).';
