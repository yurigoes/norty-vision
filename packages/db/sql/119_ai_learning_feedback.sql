-- ==============================================================================
-- 119_ai_learning_feedback.sql  (idempotente)
--
-- Ecossistema de IA — Fase 3: feedback (👍/👎) nas respostas do bot, alimentando
-- o score de aprendizado. null = ainda não avaliado.
-- ==============================================================================

ALTER TABLE ai_learning_events
  ADD COLUMN IF NOT EXISTS helpful boolean;
