-- ==============================================================================
-- 078_appointment_reply_session.sql  (idempotente)
--
-- Sessão de resposta do cliente na confirmação de agendamento + dedup atômico
-- das mensagens inbound do WhatsApp.
--
-- 1) Colunas de "sessão" no appointment:
--    - reply_open_at:        quando enviamos um convite a responder (agendou/lembrete).
--    - customer_responded_at: quando o cliente respondeu (mata a sessão).
--    - customer_response:     o que ele respondeu (confirm/cancel/reschedule/opt_out).
--    Uma resposta só age se houver sessão ABERTA (reply_open_at IS NOT NULL
--    AND customer_responded_at IS NULL). Resolveu → ignora respostas seguintes
--    até um novo convite (lembrete) reabrir.
--
-- 2) Dedup atômico: troca o índice não-único de message_log por um UNIQUE,
--    pra o webhook usar INSERT ... ON CONFLICT DO NOTHING e processar cada
--    mensagem exatamente uma vez (corrige o envio em duplicidade).
-- ==============================================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reply_open_at         timestamptz,
  ADD COLUMN IF NOT EXISTS customer_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_response     text;

-- backfill: agendamentos em andamento (pendente/confirmado, futuros, ainda sem
-- desfecho) ganham uma sessão aberta retroativa, pra não pararem de aceitar
-- resposta logo após o deploy (até o próximo lembrete reabrir naturalmente).
UPDATE appointments
   SET reply_open_at = COALESCE(reminded_at, created_at)
 WHERE reply_open_at IS NULL
   AND customer_responded_at IS NULL
   AND deleted_at IS NULL
   AND status IN ('pending','confirmed','rescheduled')
   AND starts_at >= now() - interval '1 day';

-- remove duplicatas de message_log (mantém a linha mais antiga por ctid)
DELETE FROM message_log a
 USING message_log b
 WHERE a.channel_message_id IS NOT NULL
   AND a.channel = b.channel
   AND a.channel_message_id = b.channel_message_id
   AND a.ctid > b.ctid;

-- troca o índice não-único por um UNIQUE (habilita ON CONFLICT atômico)
DROP INDEX IF EXISTS message_log_channel_msg_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ux_message_log_channel_msgid
  ON message_log (channel, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
