-- ==============================================================================
-- 002_tenancy.sql
-- Nucleo de multi-tenancy: organizations, stores, users, memberships, roles.
-- Ver docs/adr/0001-multi-tenancy-model.md
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ORGANIZATIONS - cliente master (paga a assinatura)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- identificacao
  slug            citext NOT NULL UNIQUE,                  -- 'rede-otica-x'
  name            text   NOT NULL,
  legal_name      text,                                    -- razao social
  document        text,                                    -- CNPJ ou CPF, normalizado
  document_type   text CHECK (document_type IN ('cnpj','cpf')),

  -- contato
  contact_email   citext,
  contact_phone   text,

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','canceled','trial')),
  trial_ends_at   timestamptz,

  -- plano (FK pra plans no futuro; nao bloqueia agora)
  plan_code       text NOT NULL DEFAULT 'trial',

  -- preferencias
  default_locale  text NOT NULL DEFAULT 'pt-BR',
  default_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- branding
  logo_url        text,
  primary_color   text,

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_status_idx
  ON organizations (status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_organizations_updated_at ON organizations;
CREATE TRIGGER tg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE organizations IS
  'Cliente master da plataforma. Pai de todas as Stores.';

-- ------------------------------------------------------------------------------
-- STORES - filiais/lojas de uma organization
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- identificacao
  slug            citext NOT NULL,                         -- unico dentro da org
  name            text   NOT NULL,

  -- contato/endereco
  document        text,                                    -- CNPJ proprio da unidade
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,                                    -- UF
  postal_code     text,
  country         text NOT NULL DEFAULT 'BR',
  contact_email   citext,
  contact_phone   text,

  -- operacao
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','closed')),

  -- preferencias locais (overridable da org)
  business_hours  jsonb,                                   -- {mon: {open:"08:00",close:"18:00"}, ...}

  -- integracao com WhatsApp/canal
  whatsapp_instance_id text,                               -- referencia Evolution API

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS stores_org_idx
  ON stores (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS stores_status_idx
  ON stores (organization_id, status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_stores_updated_at ON stores;
CREATE TRIGGER tg_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE stores IS
  'Filial/loja fisica. Toda dado de negocio pendurado em store_id.';

-- ------------------------------------------------------------------------------
-- USERS - credenciais humanas (globalmente unicas por email)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- identidade
  email           citext NOT NULL UNIQUE,
  name            text   NOT NULL,
  avatar_url      text,

  -- credenciais (Argon2id PHC string)
  password_hash   text   NOT NULL,

  -- 2FA TOTP (RFC 6238)
  mfa_enabled     boolean NOT NULL DEFAULT false,
  mfa_secret      text,                                    -- criptografado em app, base32 raw
  mfa_recovery_codes_hash jsonb,                           -- array de hashes de codigos one-shot

  -- contato adicional
  phone           text,

  -- preferencias
  locale          text NOT NULL DEFAULT 'pt-BR',
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- bloqueio
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','pending_verification','disabled')),
  email_verified_at timestamptz,
  last_login_at   timestamptz,
  last_login_ip   inet,
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until    timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_users_updated_at ON users;
CREATE TRIGGER tg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE users IS
  'Humano com credencial de login. Globalmente unico por email. Sem FK pra organization (user pode pertencer a varias via memberships).';

-- ------------------------------------------------------------------------------
-- ROLES - papeis de acesso (templates + custom por organizacao)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  -- null = role global da plataforma (template padrao)

  slug            citext NOT NULL,                         -- 'owner', 'admin', 'recepcao', 'medico', 'vendedor', 'readonly'
  name            text   NOT NULL,                         -- nome amigavel pra UI
  description     text,

  -- permissoes em JSON estruturado:
  -- {
  --   "appointments": {"read": "store", "write": "store"},
  --   "leads":        {"read": "org",   "write": "store"},
  --   "billing":      {"read": "org",   "write": "none"},
  -- }
  -- Escopo: "none" | "self" | "store" | "org" | "platform"
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- flag pra UI
  is_default      boolean NOT NULL DEFAULT false,
  is_system       boolean NOT NULL DEFAULT false,          -- nao pode deletar

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- NULLS NOT DISTINCT pra que organization_id=NULL (templates) seja unico por slug
  UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

DROP TRIGGER IF EXISTS tg_roles_updated_at ON roles;
CREATE TRIGGER tg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE roles IS
  'Papeis de acesso. organization_id NULL = template global, copiado quando uma org e criada.';

-- ------------------------------------------------------------------------------
-- MEMBERSHIPS - relacao N:M entre user e store, com role
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid REFERENCES stores(id) ON DELETE RESTRICT,
  -- store_id NULL = membership a nivel de organizacao (acesso a TODAS as lojas, sujeito ao role)

  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','revoked','pending')),
  invited_by      uuid REFERENCES users(id),
  invited_at      timestamptz,
  accepted_at     timestamptz,
  revoked_at      timestamptz,

  -- preferencia: se este eh o membership "padrao" do user (carrega ao logar)
  is_primary      boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- nao duplica user+store. NULL em store_id permite 1 membership de org-level.
  UNIQUE (user_id, organization_id, store_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_idx
  ON memberships (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS memberships_store_idx
  ON memberships (store_id) WHERE status = 'active' AND store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memberships_org_idx
  ON memberships (organization_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS tg_memberships_updated_at ON memberships;
CREATE TRIGGER tg_memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE memberships IS
  'Relacao user x store x role. store_id NULL = membership de organizacao toda.';

-- ------------------------------------------------------------------------------
-- SESSIONS - tokens de sessao httpOnly (Better-Auth compativel)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- token armazenado como hash (sha256). raw soh existe no cookie.
  token_hash      text NOT NULL UNIQUE,

  -- contexto ativo (qual membership esta selecionado neste login)
  active_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,

  -- metadata
  ip_address      inet,
  user_agent      text,
  device_label    text,                                    -- 'Chrome no Windows'

  -- ciclo de vida
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoke_reason   text,                                    -- 'logout','password_change','mfa_setup','admin_force'

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expires_idx
  ON sessions (expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS
  'Sessao httpOnly. token_hash = sha256 do token raw que vai no cookie.';

-- ------------------------------------------------------------------------------
-- PLATFORM_USERS - super-admins do yugo (separados dos users normais)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_users (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  email           citext NOT NULL UNIQUE,
  name            text   NOT NULL,
  password_hash   text   NOT NULL,
  mfa_enabled     boolean NOT NULL DEFAULT true,           -- obrigatorio
  mfa_secret      text,
  mfa_recovery_codes_hash jsonb,

  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','disabled')),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_platform_users_updated_at ON platform_users;
CREATE TRIGGER tg_platform_users_updated_at
  BEFORE UPDATE ON platform_users
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE platform_users IS
  'Super-admin do yugo. Isolado dos users normais. MFA obrigatorio. Acoes ficam em audit_log com flag as_platform_admin.';
