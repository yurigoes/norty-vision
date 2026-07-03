-- ==============================================================================
-- 035_message_templates.sql
-- Modelos de mensagem por empresa (email e WhatsApp) com botao de teste, e
-- configuracao de SMTP proprio por empresa (com fallback do master).
--
--   message_templates        — corpo + assunto por canal/codigo, com variaveis
--                              {{chave}} substituidas no envio.
--   organization_smtp_settings — SMTP da empresa; envio em nome da empresa,
--                              reply-to da empresa. Senha protegida por RLS.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- message_templates
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  channel         text NOT NULL CHECK (channel IN ('email','whatsapp')),
  code            text NOT NULL,             -- ex: 'cobranca_vencida', 'boas_vindas'
  name            text NOT NULL,
  subject         text,                      -- so email
  body            text NOT NULL,             -- markdown/texto com {{variaveis}}
  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, channel, code)
);

CREATE INDEX IF NOT EXISTS message_templates_org_idx
  ON message_templates (organization_id, channel);

DROP TRIGGER IF EXISTS tg_message_templates_updated_at ON message_templates;
CREATE TRIGGER tg_message_templates_updated_at BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_templates_rls ON message_templates;
CREATE POLICY message_templates_rls ON message_templates FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- organization_smtp_settings — SMTP proprio da empresa (fallback master)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_smtp_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  host            text,
  port            int  NOT NULL DEFAULT 587,
  secure          boolean NOT NULL DEFAULT false,
  username        text,
  password        text,                      -- RLS protege; futuro: cifrar
  from_name       text,                      -- nome de exibicao (empresa)
  from_email      text,                      -- remetente
  reply_to        text,                      -- reply-to da empresa
  enabled         boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_org_smtp_updated_at ON organization_smtp_settings;
CREATE TRIGGER tg_org_smtp_updated_at BEFORE UPDATE ON organization_smtp_settings
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE organization_smtp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_smtp_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_smtp_rls ON organization_smtp_settings;
CREATE POLICY org_smtp_rls ON organization_smtp_settings FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE message_templates IS
  'Modelos de email/WhatsApp por empresa, com {{variaveis}} substituidas no envio.';
COMMENT ON TABLE organization_smtp_settings IS
  'SMTP proprio da empresa. Se enabled=false ou sem host, usa o SMTP do master (em nome da empresa, reply-to da empresa).';
