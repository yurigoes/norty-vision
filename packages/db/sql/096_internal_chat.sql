-- ==============================================================================
-- 096_internal_chat.sql  (idempotente)
--
-- Conversa interna entre atendentes (DM 1:1 entre membros da empresa), separada
-- das notas internas que ficam na conversa do cliente.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS internal_messages (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  to_membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  body               text NOT NULL,
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS internal_messages_pair_idx ON internal_messages (organization_id, from_membership_id, to_membership_id, created_at);
CREATE INDEX IF NOT EXISTS internal_messages_to_unread_idx ON internal_messages (to_membership_id) WHERE read_at IS NULL;
ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_messages_rls ON internal_messages;
CREATE POLICY internal_messages_rls ON internal_messages FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
