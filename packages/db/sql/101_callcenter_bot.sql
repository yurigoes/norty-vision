-- ==============================================================================
-- 101_callcenter_bot.sql  (idempotente)
--
-- Interruptor do atendimento automático por IA + instruções do negócio (pra a
-- IA funcionar em qualquer nicho, não só ótica).
-- ==============================================================================

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS bot_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_instructions text;
