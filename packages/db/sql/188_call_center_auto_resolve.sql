-- 188_call_center_auto_resolve.sql
-- Auto-resolução silenciosa de conversas inativas: depois de N horas sem mensagem
-- (do cliente OU do operador), a conversa é resolvida automaticamente sem mandar
-- nada pro cliente. Evita acúmulo de conversas "esquecidas" na caixa.
-- Default 0 = desligado (mantém comportamento atual).
-- Toggle em Atendimento → Configurações.

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS auto_resolve_hours integer NOT NULL DEFAULT 0;
