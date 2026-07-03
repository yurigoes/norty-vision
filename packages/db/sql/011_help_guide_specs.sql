-- ==============================================================================
-- 011_help_guide_specs.sql
-- Tres areas de conteudo do produto:
--   1. HELP_ARTICLES        - passo-a-passo de uso (publico p/ users logados)
--   2. SYSTEM_GUIDE_SECTIONS- guia detalhado de cada modulo (publico p/ users logados)
--   3. TECH_SPECS           - especificacoes tecnicas (RESTRITO; master decide quem ve)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- HELP_ARTICLES - aba "Ajuda" (alimentada conforme o sistema cresce)
-- Conteudo em markdown. Versionado. Multilingue.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_articles (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- escopo: NULL=global (todos veem), org_id=customizado por org
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,

  -- identificacao
  slug            citext NOT NULL,                        -- 'agenda-criar-slot'
  category        text NOT NULL,                          -- 'agenda','leads','disparador','config','geral'

  -- conteudo
  locale          text NOT NULL DEFAULT 'pt-BR',
  title           text NOT NULL,
  summary         text,                                   -- 1-2 frases pra listagem
  body_markdown   text NOT NULL,
  body_html       text,                                   -- cache do markdown renderizado

  -- ordenacao / publicacao
  display_order   int NOT NULL DEFAULT 0,
  is_published    boolean NOT NULL DEFAULT true,

  -- relacoes pra UI inteligente
  related_slugs   text[] NOT NULL DEFAULT '{}',           -- "veja tambem"
  tags            text[] NOT NULL DEFAULT '{}',

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  version         int NOT NULL DEFAULT 1,

  UNIQUE NULLS NOT DISTINCT (organization_id, slug, locale)
);

CREATE INDEX IF NOT EXISTS help_articles_cat_idx
  ON help_articles (category, display_order) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS help_articles_search_idx
  ON help_articles USING gin ((to_tsvector('portuguese', title || ' ' || coalesce(summary,'') || ' ' || body_markdown)));

DROP TRIGGER IF EXISTS tg_help_articles_updated_at ON help_articles;
CREATE TRIGGER tg_help_articles_updated_at
  BEFORE UPDATE ON help_articles
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE help_articles IS
  'Aba Ajuda. Alimentada conforme o sistema evolui. Acessivel a qualquer user logado.';

-- ------------------------------------------------------------------------------
-- SYSTEM_GUIDE_SECTIONS - aba "Guia do Sistema" (visao geral arquitetural)
-- Estrutura em arvore (parent_id) pra navegacao tipo livro.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_guide_sections (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- arvore
  parent_id       uuid REFERENCES system_guide_sections(id) ON DELETE CASCADE,
  depth           int NOT NULL DEFAULT 0,                 -- 0=raiz, 1=capitulo, 2=secao
  path            text NOT NULL,                          -- 'agenda/slots/criar' (materialized path)

  -- conteudo
  slug            citext NOT NULL,
  title           text NOT NULL,
  body_markdown   text NOT NULL,
  body_html       text,
  module          text,                                   -- 'agenda','leads','disparador','config','platform','overview'

  -- ordenacao
  display_order   int NOT NULL DEFAULT 0,
  is_published    boolean NOT NULL DEFAULT true,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  version         int NOT NULL DEFAULT 1,

  UNIQUE (path)
);

CREATE INDEX IF NOT EXISTS system_guide_module_idx
  ON system_guide_sections (module, display_order) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS system_guide_parent_idx
  ON system_guide_sections (parent_id, display_order);

DROP TRIGGER IF EXISTS tg_system_guide_updated_at ON system_guide_sections;
CREATE TRIGGER tg_system_guide_updated_at
  BEFORE UPDATE ON system_guide_sections
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE system_guide_sections IS
  'Aba Guia do Sistema. Estrutura em arvore. Detalha o que cada parte do sistema faz.';

-- ------------------------------------------------------------------------------
-- TECH_SPEC_DOCUMENTS - aba "Specs Tecnicas" (RESTRITO)
-- Soh platform_admin (master) e usuarios com grant explicito veem.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_spec_documents (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  slug            citext NOT NULL UNIQUE,                 -- 'stack','seguranca','infra','schema','...'
  category        text NOT NULL,                          -- 'arquitetura','seguranca','infra','dados','integracoes'

  title           text NOT NULL,
  summary         text,
  body_markdown   text NOT NULL,
  body_html       text,

  -- ordenacao
  display_order   int NOT NULL DEFAULT 0,
  is_published    boolean NOT NULL DEFAULT true,

  -- versao (controle de mudancas)
  version         int NOT NULL DEFAULT 1,
  changelog       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{"v":1,"date":"...","by":"...","note":"..."}]

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS tech_spec_documents_cat_idx
  ON tech_spec_documents (category, display_order) WHERE is_published = true;

DROP TRIGGER IF EXISTS tg_tech_spec_documents_updated_at ON tech_spec_documents;
CREATE TRIGGER tg_tech_spec_documents_updated_at
  BEFORE UPDATE ON tech_spec_documents
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE tech_spec_documents IS
  'Aba Specs Tecnicas. Detalha stack, seguranca, infra. Acesso restrito (ver tech_spec_access_grants).';

-- ------------------------------------------------------------------------------
-- TECH_SPEC_ACCESS_GRANTS - whitelist + senha de acesso
-- O master (platform_admin) cria um grant para um email; sistema gera
-- senha aleatoria que o user usa pra "destravar" a aba.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_spec_access_grants (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- a quem foi dado (lookup por email; user_id resolvido tardiamente)
  granted_to_email citext NOT NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  -- user_id preenchido no primeiro login bem sucedido com a senha (o ID
  -- resolvido permite revogar mesmo se o email mudar)

  -- senha aleatoria (hash Argon2id; raw soh existe no momento da criacao
  -- e e retornado pro master pra repassar)
  access_password_hash text NOT NULL,
  access_password_last4 text,                              -- pra exibir "termina em ...X3Y9" na UI

  -- escopo: quais categorias o user pode ver
  -- ['*'] = todas; ['arquitetura','seguranca'] = soh essas
  allowed_categories text[] NOT NULL DEFAULT '{*}',

  -- expira opcional
  expires_at      timestamptz,

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','revoked','expired','superseded')),

  -- audit
  granted_by_platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE RESTRICT,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  first_used_at   timestamptz,
  last_used_at    timestamptz,
  use_count       int NOT NULL DEFAULT 0,

  revoked_at      timestamptz,
  revoked_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  revoked_reason  text
);

CREATE INDEX IF NOT EXISTS tech_spec_grants_email_idx
  ON tech_spec_access_grants (granted_to_email) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS tech_spec_grants_user_idx
  ON tech_spec_access_grants (user_id) WHERE status = 'active' AND user_id IS NOT NULL;

COMMENT ON TABLE tech_spec_access_grants IS
  'Whitelist de acesso a tech_spec_documents. Master cria; user usa senha + login normal.';

-- ------------------------------------------------------------------------------
-- TECH_SPEC_ACCESS_LOG - quem acessou a aba quando
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_spec_access_log (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),

  grant_id        uuid REFERENCES tech_spec_access_grants(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  email           citext,

  action          text NOT NULL CHECK (action IN (
    'unlock_success','unlock_failed','view_document','export','grant_created','grant_revoked'
  )),
  document_id     uuid REFERENCES tech_spec_documents(id) ON DELETE SET NULL,

  ip_address      inet,
  user_agent      text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS tech_spec_access_log_user_idx
  ON tech_spec_access_log (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tech_spec_access_log_action_idx
  ON tech_spec_access_log (action, created_at DESC);

DROP TRIGGER IF EXISTS tg_tech_spec_access_log_no_update ON tech_spec_access_log;
CREATE TRIGGER tg_tech_spec_access_log_no_update
  BEFORE UPDATE OR DELETE ON tech_spec_access_log
  FOR EACH ROW EXECUTE FUNCTION app.tg_block_modification();

COMMENT ON TABLE tech_spec_access_log IS
  'Trail de acessos a aba Specs Tecnicas. Append-only. Inclui tentativas falhas.';

-- ------------------------------------------------------------------------------
-- Helper: marca acesso atual como autorizado nas Specs Tecnicas
-- A API faz SET LOCAL app.tech_specs_unlocked='true' apos validar a senha.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.has_tech_specs_access() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    app.is_platform_admin()
    OR coalesce(current_setting('app.tech_specs_unlocked', true), 'false') = 'true';
$$;
