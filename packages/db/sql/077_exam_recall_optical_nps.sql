-- ==============================================================================
-- 077_exam_recall_optical_nps.sql
-- - Lembrete de exame: 1 ano após o exame (consulta com o médico) avisa o cliente
--   que venceu e oferece remarcar. Só vale pra agendamento (exame), não pra venda.
-- - NPS 15 dias após o óculos chegar: pesquisa rápida de experiência com o óculos novo.
-- ==============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS exam_recall_sent_at timestamptz;
ALTER TABLE lens_orders  ADD COLUMN IF NOT EXISTS experience_survey_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS appointments_recall_idx ON appointments (organization_id, status, starts_at)
  WHERE exam_recall_sent_at IS NULL;

COMMENT ON COLUMN appointments.exam_recall_sent_at IS 'Quando o lembrete de exame anual (1 ano) foi enviado.';
COMMENT ON COLUMN lens_orders.experience_survey_sent_at IS 'Quando a pesquisa de experiência (15 dias após chegar) foi enviada.';
