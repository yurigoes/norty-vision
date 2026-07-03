-- ==============================================================================
-- 100_kb.sql  (idempotente)
--
-- Base de conhecimento / central de ajuda do call center: perguntas frequentes
-- com respostas (rascunho por IA ou escritas pela equipe), que o operador edita,
-- publica, envia ao cliente, e que o cliente vê no portal (com o slug da empresa).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS kb_entries (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  topic            text,
  question         text NOT NULL,
  answer           text NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ai_generated     boolean NOT NULL DEFAULT false,
  usage_count      int NOT NULL DEFAULT 0,
  display_order    int NOT NULL DEFAULT 0,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_entries_org_status_idx ON kb_entries (organization_id, status, display_order);
DROP TRIGGER IF EXISTS tg_kb_entries_updated_at ON kb_entries;
CREATE TRIGGER tg_kb_entries_updated_at BEFORE UPDATE ON kb_entries
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_entries_rls ON kb_entries;
CREATE POLICY kb_entries_rls ON kb_entries FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
