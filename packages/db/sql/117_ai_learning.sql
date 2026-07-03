-- ==============================================================================
-- 117_ai_learning.sql  (idempotente)
--
-- Ecossistema de IA proprietário — FASE 1 (fundação do aprendizado).
-- Registra os eventos do bot por empresa (multi-tenant isolado): respostas,
-- incertezas, fallbacks, transferências e tools. Vira a base para:
--   - painel de assertividade e gargalos (admin e master);
--   - dúvidas da IA para intervenção humana (o admin "ensina" → vira KB);
--   - futura memória vetorial / embeddings / score de aprendizado / modelos locais.
-- Sem segredos aqui; é telemetria de uso do bot.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ai_learning_events (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id) ON DELETE SET NULL,
  conversation_id   uuid,
  bot_session_id    uuid,
  module            text NOT NULL DEFAULT 'atendimento',
  event_type        text NOT NULL
                      CHECK (event_type IN ('answered','uncertain','fallback','handoff','tool','human_teach')),
  question          text,
  response          text,
  provider          text,
  model             text,
  confidence        double precision,
  resolved          boolean NOT NULL DEFAULT false,   -- dúvida tratada por humano
  reviewed_by_user_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_learning_events_org_idx ON ai_learning_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_learning_events_doubts_idx ON ai_learning_events (organization_id, event_type, resolved);

ALTER TABLE ai_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_learning_events_rls ON ai_learning_events;
CREATE POLICY ai_learning_events_rls ON ai_learning_events FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
