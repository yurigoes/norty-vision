-- ==============================================================================
-- 025_contracts.sql
-- Sistema de contratos com campos dinamicos e assinatura digital.
--
-- contract_templates: modelos com placeholders {{campo}} no corpo markdown
--                     e schema JSON descrevendo os campos do formulario.
--                     organization_id NULL = global (master); preenchido = template
--                     proprio da org.
-- contracts:          instancias preenchidas e assinaveis. Quando signer_token e
--                     valido, podem ser abertas publicamente em /assinar/:token.
--                     Apos assinatura, congela rendered_body e dados do signatario.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- contract_templates
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_templates (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL = global (master). Disponivel pra todas as orgs como template base.

  slug            text NOT NULL,
  title           text NOT NULL,
  description     text,
  body_markdown   text NOT NULL,
  -- placeholders no formato {{nome_do_campo}} substituidos por field_values na hora da assinatura

  fields_schema   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- array de { name, label, type, required, options? }
  -- type: 'text' | 'email' | 'cpf' | 'cnpj' | 'phone' | 'date' | 'select' | 'textarea'

  version         int NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,

  signature_mode  text NOT NULL DEFAULT 'click'
                  CHECK (signature_mode IN ('click','draw')),
  -- click: aceite eletronico simples; draw: canvas com imagem da rubrica

  requires_signature boolean NOT NULL DEFAULT true,

  created_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  created_by_user_id          uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, slug, version)
);

CREATE INDEX IF NOT EXISTS contract_templates_org_idx
  ON contract_templates (organization_id);
CREATE INDEX IF NOT EXISTS contract_templates_active_idx
  ON contract_templates (is_active) WHERE is_active;

DROP TRIGGER IF EXISTS tg_contract_templates_updated_at ON contract_templates;
CREATE TRIGGER tg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_templates_read ON contract_templates;
CREATE POLICY contract_templates_read ON contract_templates
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR organization_id IS NULL
    OR organization_id = app.current_org_id()
  );

DROP POLICY IF EXISTS contract_templates_write ON contract_templates;
CREATE POLICY contract_templates_write ON contract_templates
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
-- contracts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  template_id     uuid NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,

  -- contexto da org "dona" do contrato (quem enviou pra signatura)
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,

  -- dados do signatario (preenchidos pelo emissor ou pelo proprio signer)
  signer_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  signer_email    text,
  signer_name     text,
  signer_document text,
  signer_phone    text,

  -- valores dos campos dinamicos (preenche placeholders no body)
  field_values    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- corpo renderizado, congelado no momento da assinatura
  rendered_body_markdown text,

  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','signed','cancelled','expired')),

  -- token publico (sha-256 hex de algo random) pra abrir /assinar/:token sem login
  signer_token    text UNIQUE,
  token_expires_at timestamptz,

  sent_at         timestamptz,
  signed_at       timestamptz,

  signature_image_url text,           -- se signature_mode='draw'
  signer_ip       inet,
  signer_user_agent text,

  pdf_url         text,               -- futuro: gerado por job

  created_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  created_by_user_id          uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contracts_template_idx ON contracts (template_id);
CREATE INDEX IF NOT EXISTS contracts_org_idx      ON contracts (organization_id);
CREATE INDEX IF NOT EXISTS contracts_status_idx   ON contracts (status);
CREATE INDEX IF NOT EXISTS contracts_signer_email_idx ON contracts (signer_email);

DROP TRIGGER IF EXISTS tg_contracts_updated_at ON contracts;
CREATE TRIGGER tg_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_read ON contracts;
CREATE POLICY contracts_read ON contracts
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  );

DROP POLICY IF EXISTS contracts_write ON contracts;
CREATE POLICY contracts_write ON contracts
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
-- Seed: um template global de exemplo
-- ------------------------------------------------------------------------------
INSERT INTO contract_templates (
  organization_id, slug, title, description, body_markdown, fields_schema,
  signature_mode, is_active
)
VALUES (
  NULL,
  'termo-adesao-yugochat',
  'Termo de Adesao Yugochat',
  'Termo padrao de adesao ao servico da plataforma Yugochat.',
$body$
# Termo de Adesao

Pelo presente instrumento, eu **{{nome_completo}}**, portador do documento
**{{documento}}**, com email **{{email}}**, declaro estar de acordo com os
termos do servico Yugochat.

## 1. Objeto

Este termo regula o uso da plataforma Yugochat para gestao de **{{empresa}}**
no segmento **{{segmento}}**.

## 2. Responsabilidades

- O contratante e responsavel pelos dados cadastrados no sistema.
- A plataforma garante criptografia em transito (TLS 1.3) e em repouso (Argon2id).
- Backup diario do banco e politica de retencao de 30 dias estao ativos.

## 3. Vigencia

Vigencia indeterminada, com possibilidade de cancelamento a qualquer momento
mediante aviso previo de 30 dias.

## 4. LGPD

O tratamento de dados pessoais segue a Lei 13.709/2018 (LGPD). Os direitos
do titular estao detalhados em /app/suporte/privacidade.

---

Ao clicar em "Aceitar", o contratante declara ter lido e concordado com
todos os itens deste termo.
$body$,
  '[
    {"name":"nome_completo","label":"Nome completo","type":"text","required":true},
    {"name":"documento","label":"CPF ou CNPJ","type":"text","required":true},
    {"name":"email","label":"Email","type":"email","required":true},
    {"name":"empresa","label":"Empresa","type":"text","required":true},
    {"name":"segmento","label":"Segmento","type":"select","required":true,
     "options":["otica","clinica","comercio","outros"]}
  ]'::jsonb,
  'click',
  true
)
ON CONFLICT (organization_id, slug, version) DO NOTHING;

COMMENT ON TABLE contract_templates IS
  'Modelos de contratos com placeholders e campos dinamicos. NULL=global, FK=org-owned.';
COMMENT ON TABLE contracts IS
  'Instancias de contratos enviadas para assinatura. Token publico habilita /assinar/:token.';
