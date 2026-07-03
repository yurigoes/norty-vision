-- ==============================================================================
-- 022_external_provisioning.sql
-- Rastreio de provisionamento em sistemas externos (Chatwoot, GLPI, Evolution).
-- Quando o yugo cria uma org/store/user, um worker cria nos 3 sistemas e
-- registra o id externo aqui. Permite retry, reconciliacao, e undo.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- IDs externos em organizations
-- ------------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS chatwoot_account_id text,
  ADD COLUMN IF NOT EXISTS glpi_entity_id      text;

-- ------------------------------------------------------------------------------
-- IDs externos em stores
-- ------------------------------------------------------------------------------
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS evolution_instance_name text,
  ADD COLUMN IF NOT EXISTS evolution_instance_status text
    CHECK (evolution_instance_status IS NULL OR evolution_instance_status IN
      ('pending','qr_required','connected','disconnected','failed')),
  ADD COLUMN IF NOT EXISTS glpi_group_id text;

-- ------------------------------------------------------------------------------
-- IDs externos em users
-- ------------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chatwoot_user_id text,
  ADD COLUMN IF NOT EXISTS glpi_user_id text;

-- ------------------------------------------------------------------------------
-- external_provisioning_log: trail append-only de TODA acao em sistema externo
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_provisioning_log (
  id              bigserial PRIMARY KEY,

  -- escopo
  provider        text NOT NULL,                -- 'chatwoot' | 'glpi' | 'evolution'
  action          text NOT NULL,                -- 'create_account', 'create_user', 'create_entity',
                                                -- 'create_instance', 'sync_user', 'delete_user', etc

  -- entidades envolvidas (NULL conforme contexto)
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,

  -- resultado
  status          text NOT NULL CHECK (status IN ('success','failed','retry_pending')),
  external_id     text,                         -- ID retornado pelo sistema externo
  http_status     int,
  request_body    jsonb,                        -- redact senha antes
  response_body   jsonb,
  error_message   text,
  attempt         int NOT NULL DEFAULT 1,

  -- audit
  triggered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  triggered_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  duration_ms     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS epl_provider_status_idx
  ON external_provisioning_log (provider, status, created_at DESC);
CREATE INDEX IF NOT EXISTS epl_org_idx
  ON external_provisioning_log (organization_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS epl_user_idx
  ON external_provisioning_log (user_id, created_at DESC);

-- append-only
DROP TRIGGER IF EXISTS tg_epl_no_update ON external_provisioning_log;
CREATE TRIGGER tg_epl_no_update
  BEFORE UPDATE OR DELETE ON external_provisioning_log
  FOR EACH ROW EXECUTE FUNCTION app.tg_block_modification();

-- RLS: org admin ve da sua org; platform ve tudo
ALTER TABLE external_provisioning_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_provisioning_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS epl_read ON external_provisioning_log;
CREATE POLICY epl_read ON external_provisioning_log
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

DROP POLICY IF EXISTS epl_insert ON external_provisioning_log;
CREATE POLICY epl_insert ON external_provisioning_log
  FOR INSERT
  WITH CHECK (true);  -- workers e API inserem livremente

COMMENT ON TABLE external_provisioning_log IS
  'Trail append-only de toda chamada a sistema externo. Use pra debug, reconciliacao e provar provisionamento.';
