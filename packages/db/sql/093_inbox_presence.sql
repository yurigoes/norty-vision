-- ==============================================================================
-- 093_inbox_presence.sql  (idempotente)
--
-- Presença do operador no call center + roteamento automático/fila.
--   inbox_agent_presence — status do operador (online/paused/offline), limite de
--                          conversas simultâneas e último "batimento".
--
-- A fila é derivada das conversas: open/pending SEM responsável. O roteamento
-- (na ingestão) atribui a conversa ao operador online com menos conversas ativas
-- e abaixo do limite; se ninguém disponível, fica na fila e o bot avisa a posição.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inbox_agent_presence (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','paused','offline')),
  max_concurrent  int  NOT NULL DEFAULT 6,
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, membership_id)
);
CREATE INDEX IF NOT EXISTS presence_org_status_idx ON inbox_agent_presence (organization_id, status);
DROP TRIGGER IF EXISTS tg_inbox_agent_presence_updated_at ON inbox_agent_presence;
CREATE TRIGGER tg_inbox_agent_presence_updated_at BEFORE UPDATE ON inbox_agent_presence
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE inbox_agent_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_agent_presence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_agent_presence_rls ON inbox_agent_presence;
CREATE POLICY inbox_agent_presence_rls ON inbox_agent_presence FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- marca de quando a conversa entrou na fila (1ª vez sem responsável) e se o bot
-- já avisou a posição, pra não floodar.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS queued_at        timestamptz,
  ADD COLUMN IF NOT EXISTS queue_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_assigned    boolean NOT NULL DEFAULT false;
