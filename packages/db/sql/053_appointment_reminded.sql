-- ==============================================================================
-- 053_appointment_reminded.sql
-- Marca quando o lembrete do agendamento foi enviado (evita reenvio).
-- ==============================================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

CREATE INDEX IF NOT EXISTS appointments_reminder_idx
  ON appointments (starts_at) WHERE reminded_at IS NULL;
