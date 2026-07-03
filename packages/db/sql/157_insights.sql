-- ==============================================================================
-- 157_insights.sql  (idempotente)  —  IA PROATIVA: gargalos por empresa + dúvidas ao master
--
-- org_insight: achados de gargalo por empresa (regras; resumo redigido pela IA).
--   Visível ao admin da empresa e, agregado, ao master.
-- ai_master_question: a IA do ecossistema pergunta ao master pra aprender mais
--   (dúvidas/dicas recorrentes detectadas por regras). Só o master vê/responde.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS org_insight (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL,                           -- ex.: producao_parada, parcela_vencida, estoque_baixo, atendimento_parado, resumo
  severity         text NOT NULL DEFAULT 'info',            -- info | warn | urgent
  title            text NOT NULL,
  detail           text,
  metric           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'open',            -- open | dismissed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind)
);
CREATE INDEX IF NOT EXISTS ix_org_insight ON org_insight (organization_id, status, severity);
ALTER TABLE org_insight ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_insight FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_insight_rls ON org_insight;
CREATE POLICY org_insight_rls ON org_insight FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS ai_master_question (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  topic            text,
  question         text NOT NULL,
  context          text,
  status           text NOT NULL DEFAULT 'open',            -- open | answered | dismissed
  answer           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  answered_by      uuid
);
CREATE INDEX IF NOT EXISTS ix_ai_master_question ON ai_master_question (status, created_at);
ALTER TABLE ai_master_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_master_question FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_master_question_rls ON ai_master_question;
-- só o master (plataforma) acessa o conhecimento do ecossistema.
CREATE POLICY ai_master_question_rls ON ai_master_question FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());
