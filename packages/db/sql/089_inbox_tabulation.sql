-- ==============================================================================
-- 089_inbox_tabulation.sql  (idempotente)
--
-- Tabulação + protocolo de atendimento (base dos relatórios de gargalo).
--   conversation_tabulations: catálogo de motivos (com grupo) por org.
--   conversations: protocolo, tabulação escolhida no fechamento, quem fechou.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS conversation_tabulations (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  group_name      text,                 -- agrupa (ex.: "Financeiro", "Pós-venda")
  is_active       boolean NOT NULL DEFAULT true,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS conv_tabulations_org_idx ON conversation_tabulations (organization_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_conv_tabulations_updated_at ON conversation_tabulations;
CREATE TRIGGER tg_conv_tabulations_updated_at BEFORE UPDATE ON conversation_tabulations
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE conversation_tabulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tabulations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_tabulations_rls ON conversation_tabulations;
CREATE POLICY conv_tabulations_rls ON conversation_tabulations FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS protocol                text,
  ADD COLUMN IF NOT EXISTS tabulation_id           uuid REFERENCES conversation_tabulations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tabulation_note         text,
  ADD COLUMN IF NOT EXISTS closed_by_membership_id uuid;

CREATE INDEX IF NOT EXISTS conversations_tabulation_idx ON conversations (organization_id, tabulation_id) WHERE tabulation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_protocol_idx ON conversations (protocol);
