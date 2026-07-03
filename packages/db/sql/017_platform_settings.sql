-- ==============================================================================
-- 017_platform_settings.sql
-- Configuracoes globais da PLATAFORMA (empresa yugochat dona do SaaS).
-- Singleton: sempre 1 row (enforced via CHECK + PRIMARY KEY fixo).
-- Editavel apenas por platform_users (master/super-admin).
--
-- NAO confundir com `organizations` (clientes do SaaS).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  -- singleton: sempre id=1; CHECK garante
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- identidade institucional do SaaS
  product_name    text   NOT NULL DEFAULT 'yugo-platform',
  tagline         text,                                          -- frase curta
  company_legal_name text,                                       -- razao social
  company_trade_name text,                                       -- nome fantasia
  company_document text,                                         -- CNPJ ou CPF
  company_document_type text CHECK (company_document_type IN ('cnpj','cpf')),

  -- endereco da empresa
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,                                          -- UF
  postal_code     text,
  country         text NOT NULL DEFAULT 'BR',

  -- contatos institucionais
  support_email   citext,
  support_phone   text,
  support_whatsapp text,
  sales_email     citext,
  privacy_email   citext,                                        -- DPO/LGPD

  -- midia
  logo_url        text,
  logo_dark_url   text,                                          -- variante pra fundos claros
  favicon_url     text,
  og_image_url    text,                                          -- compartilhamento social

  -- branding
  primary_color   text CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text CHECK (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color    text CHECK (accent_color   ~ '^#[0-9a-fA-F]{6}$'),

  -- dominios
  primary_domain  text NOT NULL DEFAULT 'yugochat.com.br',
  app_path_prefix text NOT NULL DEFAULT '/app',                  -- onde fica o dashboard
  login_path      text NOT NULL DEFAULT '/login',

  -- textos legais (markdown)
  terms_of_use_markdown    text,
  privacy_policy_markdown  text,
  lgpd_notice_markdown     text,

  -- redes sociais
  instagram_url   text,
  linkedin_url    text,
  facebook_url    text,
  twitter_url     text,
  youtube_url     text,
  github_url      text,

  -- configuracoes operacionais default
  default_locale  text NOT NULL DEFAULT 'pt-BR',
  default_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  default_currency text NOT NULL DEFAULT 'BRL',

  -- features globais (kill switches)
  feature_signup_enabled boolean NOT NULL DEFAULT true,
  feature_mfa_required_for_admin boolean NOT NULL DEFAULT true,
  feature_audit_log_retention_days int NOT NULL DEFAULT 365,

  -- meta
  notes_internal  text,                                          -- so platform_users veem
  configured_at   timestamptz,                                   -- preenchido no 1o save real

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS tg_platform_settings_updated_at ON platform_settings;
CREATE TRIGGER tg_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE platform_settings IS
  'Singleton (id=1) com config global do SaaS. Master/platform_users editam via UI.';

-- ------------------------------------------------------------------------------
-- RLS: leitura publica de campos nao-sensiveis (landing), escrita platform only
-- A propria UI da landing publica vai consumir uma VIEW filtrada (ver abaixo).
-- ------------------------------------------------------------------------------
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_read ON platform_settings;
CREATE POLICY platform_settings_read ON platform_settings
  FOR SELECT USING (true);  -- a tabela e singleton; protecao real e na view abaixo

DROP POLICY IF EXISTS platform_settings_write ON platform_settings;
CREATE POLICY platform_settings_write ON platform_settings
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- View publica: SO os campos seguros pra mostrar em landing/footer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_platform_public AS
SELECT
  product_name,
  tagline,
  company_legal_name,
  company_trade_name,
  company_document,
  city, state, country,
  support_email, support_phone, support_whatsapp,
  sales_email,
  logo_url, logo_dark_url, favicon_url, og_image_url,
  primary_color, secondary_color, accent_color,
  primary_domain, app_path_prefix, login_path,
  terms_of_use_markdown, privacy_policy_markdown, lgpd_notice_markdown,
  instagram_url, linkedin_url, facebook_url, twitter_url, youtube_url, github_url,
  default_locale, default_timezone, default_currency
FROM platform_settings
WHERE id = 1;

COMMENT ON VIEW v_platform_public IS
  'Campos publicos da platform_settings. Pode ser consumido sem autenticacao.';

GRANT SELECT ON v_platform_public TO yugo_app;

-- ------------------------------------------------------------------------------
-- Seed inicial (placeholder; master ajusta via UI)
-- ------------------------------------------------------------------------------
INSERT INTO platform_settings (
  id,
  product_name, tagline,
  company_trade_name, primary_domain, app_path_prefix, login_path,
  primary_color, secondary_color, accent_color,
  support_email, sales_email, privacy_email
)
VALUES (
  1,
  'yugochat',
  'Agenda, leads e disparador para empresas que crescem.',
  'yugochat', 'yugochat.com.br', '/app', '/login',
  '#60a5fa', '#0a0a0b', '#f4f4f5',
  'suporte@yugochat.com.br',
  'comercial@yugochat.com.br',
  'privacidade@yugochat.com.br'
)
ON CONFLICT (id) DO NOTHING;
