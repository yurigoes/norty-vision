-- 189_agenda_ia_config.sql
-- Config da agenda pro atendimento automático (IA) + janelas de chegada.
--
-- ai_min_booking_hour: hora mínima (0-23) que a IA pode oferecer ao cliente.
--   Horários antes disso ficam reservados pra equipe interna marcar manualmente
--   pelo painel. Default 7 (07:00). 0 = sem restrição.
--
-- exam_arrival_windows: janelas de chegada (ordem de chegada) configuráveis por
--   org, no formato JSON array de "HH:MM" (ex.: ["06:00","07:30","08:30"]).
--   NULL = usa o default do código. A mensagem de agendamento diz "a partir das
--   <janela> por ordem de chegada" usando a faixa em que o slot cai.

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS ai_min_booking_hour integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS exam_arrival_windows jsonb;

-- Lembrete "manhã do dia": flag separada do reminded_at (que é o lembrete 24h).
-- Permite mandar 1 lembrete na manhã do dia do agendamento sem duplicar com o
-- lembrete de 24h antes.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS morning_reminded_at timestamp;
