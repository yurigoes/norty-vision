-- ==============================================================================
-- 176_voip_push.sql  (idempotente)  —  Web Push do app de atendimento
-- Subscriptions Web Push (VAPID) por membership/device. Usado pra notificar
-- ramal entrante mesmo com o app fechado ("toca em qualquer tela").
-- Trigger é o lado QUE LIGA: o caller-app dá POST /voip/ring → API envia push
-- pro callee. Sem isso, o softphone só toca quando aberto.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS voip_push_subscription (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL,                 -- a quem pertence
  endpoint        text NOT NULL,                 -- URL única do push (chave natural por dispositivo)
  p256dh          text NOT NULL,                 -- chave pública ECDH do user agent
  auth            text NOT NULL,                 -- secret de autenticação
  ua              text,                          -- user-agent (pra distinguir devices)
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_push_endpoint ON voip_push_subscription (endpoint);
CREATE INDEX IF NOT EXISTS ix_voip_push_member ON voip_push_subscription (membership_id);
ALTER TABLE voip_push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_push_subscription FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_push_rls ON voip_push_subscription;
CREATE POLICY voip_push_rls ON voip_push_subscription FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
