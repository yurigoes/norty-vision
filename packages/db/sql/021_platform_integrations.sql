-- ==============================================================================
-- 021_platform_integrations.sql
-- Integracoes externas configuraveis pelo master (Evolution, Chatwoot, GLPI).
-- Singleton-like por provider (UNIQUE em provider+scope).
-- Credenciais cifradas em repouso ainda nao implementado - TODO: usar pgsodium
-- ou key vault; por enquanto armazenamos plain (so master+platform_admin RLS).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS platform_integrations (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- "evolution" | "chatwoot" | "glpi" | "mercadopago" | "smtp" | ...
  provider        text NOT NULL,

  -- escopo: NULL = global da plataforma; uuid = por organization
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,

  -- nome amigavel pra UI
  label           text NOT NULL,
  description     text,

  -- URLs principais
  base_url        text NOT NULL,                 -- ex: https://evolution.example.com
  webhook_url     text,                          -- callbacks de entrada
  console_url     text,                          -- link pro painel (Chatwoot UI, GLPI UI)

  -- credenciais (cifrar com pgsodium em proximas rodadas)
  api_key         text,
  api_token       text,
  username        text,
  password        text,

  -- config extra
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','error')),
  last_ping_at    timestamptz,
  last_ping_status text,

  -- branding/visual: se este servico deve aparecer embedded no /app
  embed_enabled   boolean NOT NULL DEFAULT false,
  embed_label     text,                          -- nome no menu
  embed_icon      text,                          -- nome de icone (lucide)

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,

  UNIQUE NULLS NOT DISTINCT (provider, organization_id)
);

CREATE INDEX IF NOT EXISTS platform_integrations_provider_idx
  ON platform_integrations (provider) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS platform_integrations_org_idx
  ON platform_integrations (organization_id)
  WHERE status = 'active' AND organization_id IS NOT NULL;

DROP TRIGGER IF EXISTS tg_platform_integrations_updated_at ON platform_integrations;
CREATE TRIGGER tg_platform_integrations_updated_at
  BEFORE UPDATE ON platform_integrations
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE platform_integrations IS
  'Integracoes externas (Evolution, Chatwoot, GLPI, etc). Master configura globais; org_admin configura por org. RLS bloqueia leitura sem auth.';

-- RLS
ALTER TABLE platform_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pi_read ON platform_integrations;
CREATE POLICY pi_read ON platform_integrations
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  );

DROP POLICY IF EXISTS pi_write ON platform_integrations;
CREATE POLICY pi_write ON platform_integrations
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

-- ------------------------------------------------------------------------------
-- View segura: campos NAO sensiveis (sem api_key, password) para UI
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_platform_integrations_safe AS
SELECT
  id, provider, organization_id, label, description,
  base_url, webhook_url, console_url,
  CASE WHEN api_key IS NOT NULL THEN
    '...' || right(api_key, 4) ELSE NULL END AS api_key_preview,
  CASE WHEN api_token IS NOT NULL THEN
    '...' || right(api_token, 4) ELSE NULL END AS api_token_preview,
  username,
  CASE WHEN password IS NOT NULL THEN '••••••••' ELSE NULL END AS password_preview,
  config,
  status, last_ping_at, last_ping_status,
  embed_enabled, embed_label, embed_icon,
  created_at, updated_at
FROM platform_integrations;

GRANT SELECT ON v_platform_integrations_safe TO yugo_app;

-- ------------------------------------------------------------------------------
-- Seeds de integracoes que vamos suportar (placeholder, master preenche depois)
-- ------------------------------------------------------------------------------
INSERT INTO platform_integrations
  (provider, label, description, base_url, embed_label, embed_icon, status)
VALUES
  ('evolution',
   'Evolution API (WhatsApp)',
   'Servidor self-hosted da Evolution API para enviar/receber WhatsApp via webhook.',
   'https://evolution.example.com',
   'WhatsApp', 'message-circle',
   'disabled'),
  ('chatwoot',
   'Chatwoot (atendimento omnichannel)',
   'Plataforma open-source de chat ao vivo e tickets. Embed via widget JS.',
   'https://chatwoot.example.com',
   'Atendimento', 'headphones',
   'disabled'),
  ('glpi',
   'GLPI (helpdesk/ITSM)',
   'Sistema de tickets e gestao de TI. Integracao via API REST e SSO.',
   'https://glpi.example.com',
   'Tickets TI', 'wrench',
   'disabled')
ON CONFLICT (provider, organization_id) DO NOTHING;
