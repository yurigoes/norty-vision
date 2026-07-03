-- ==============================================================================
-- 091_inbox_token.sql  (idempotente)
--
-- Verificação por token de 4 dígitos no atendimento (WhatsApp): o operador
-- solicita, o sistema manda o código SÓ pro cliente (o operador nunca vê o
-- código), o cliente lê de volta e o operador valida. Selo na conversa:
-- not_requested | pending | validated | failed.
-- ==============================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS token_status      text NOT NULL DEFAULT 'not_requested'
    CHECK (token_status IN ('not_requested','pending','validated','failed')),
  ADD COLUMN IF NOT EXISTS token_hash        text,
  ADD COLUMN IF NOT EXISTS token_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS token_attempts    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_validated_at timestamptz;
