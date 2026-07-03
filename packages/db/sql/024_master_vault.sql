-- ==============================================================================
-- 024_master_vault.sql
-- "Cofre" de credenciais administrativas dos sistemas integrados.
-- Acesso restrito a platform_admin + sessao desbloqueada por senha especial.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- master_unlock_secret: singleton com hash da "senha mestra" do cofre.
-- Senha plana NUNCA armazenada. Quando vazio, primeiro setup pelo master.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_unlock_secret (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret_hash     text,                              -- Argon2id PHC; NULL = nao configurado
  hint            text,                              -- dica pro master lembrar
  configured_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  configured_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO master_unlock_secret (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE master_unlock_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_unlock_secret FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mus_all ON master_unlock_secret;
CREATE POLICY mus_all ON master_unlock_secret
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- admin_credentials_vault: 1 row por sistema (chatwoot, glpi, evolution, etc).
-- Reusa provider name do platform_integrations (relacao logica, nao FK).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_credentials_vault (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  provider        citext NOT NULL UNIQUE,            -- chatwoot, glpi, evolution, postgres, redis, minio, rustdesk
  label           text   NOT NULL,                   -- nome amigavel pra UI

  console_url     text,                              -- URL pra abrir o painel admin
  username        text,                              -- login do admin
  password        text,                              -- senha em texto (RLS protege; futuro: cifrar em repouso)
  notes           text,                              -- markdown livre

  -- pra integracoes que tem user externo correspondente (chatwoot, glpi)
  -- - usado pra sync de senha (PATCH no provider via id conhecido)
  external_admin_user_id text,

  is_system       boolean NOT NULL DEFAULT false,    -- entradas pre-cadastradas

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS tg_admin_credentials_vault_updated_at ON admin_credentials_vault;
CREATE TRIGGER tg_admin_credentials_vault_updated_at
  BEFORE UPDATE ON admin_credentials_vault
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE admin_credentials_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_credentials_vault FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acv_all ON admin_credentials_vault;
CREATE POLICY acv_all ON admin_credentials_vault
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- Seeds: entradas pre-cadastradas pros sistemas integrados na VPS
-- ------------------------------------------------------------------------------
INSERT INTO admin_credentials_vault (provider, label, console_url, username, notes, is_system)
VALUES
  ('chatwoot',  'Chatwoot (atendimento omnichannel)',
   'https://chatwoot.yugochat.com.br',
   NULL,
   'Super-admin do Chatwoot. Acesse /super_admin com este login.',
   true),
  ('glpi',      'GLPI (helpdesk/ITSM)',
   'https://chamados.yugochat.com.br',
   'glpi',
   'Login default era glpi/glpi - troque imediatamente apos primeiro acesso.',
   true),
  ('evolution', 'Evolution API (WhatsApp)',
   'https://evo.yugochat.com.br/manager',
   NULL,
   'Sem login - autenticacao via AUTHENTICATION_API_KEY (ver platform_integrations).',
   true),
  ('postgres',  'PostgreSQL (banco yugo)',
   NULL,
   'yugo',
   'Acesso via docker exec yugo-postgres psql -U yugo. Senha em .env.production POSTGRES_PASSWORD.',
   true),
  ('minio',     'MinIO (storage S3)',
   NULL,
   'yugo-admin',
   'Console interno; acesso via API key. Buckets: yugo-platform (privado), yugo-public.',
   true),
  ('rustdesk',  'RustDesk Server',
   NULL,
   NULL,
   'hbbs/hbbr nas portas 21115-21119. Key relay configurada como _.',
   true)
ON CONFLICT (provider) DO NOTHING;

COMMENT ON TABLE admin_credentials_vault IS
  'Cofre de credenciais admin de cada sistema integrado. Acesso so depois de unlock com senha mestra.';
