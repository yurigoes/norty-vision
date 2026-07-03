-- ==============================================================================
-- 071_platform_contracts.sql
-- Contratos master ↔ empresa contratante (onboarding, aditivos, serviço extra).
-- Espelha contrato_templates + empresa_contratos do sistema anterior:
--   - templates (do master) com markdown + variáveis {{contratante.*}} etc.
--   - contrato por empresa: snapshot do conteúdo + hash sha256 + clickwrap
--     (aceite com IP, user-agent, timestamp, nome/doc do assinante).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS platform_contract_templates (
  id           uuid PRIMARY KEY DEFAULT app.new_id(),
  version      text NOT NULL,
  title        text NOT NULL,
  description  text,
  body_markdown text NOT NULL,
  kind         text NOT NULL DEFAULT 'onboarding' CHECK (kind IN ('onboarding','aditivo','servico_extra')),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_platform_contract_templates_updated_at ON platform_contract_templates;
CREATE TRIGGER tg_platform_contract_templates_updated_at BEFORE UPDATE ON platform_contract_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- master-only (sem coluna de org)
ALTER TABLE platform_contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_contract_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_contract_templates_rls ON platform_contract_templates;
CREATE POLICY platform_contract_templates_rls ON platform_contract_templates FOR ALL
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_contracts (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id     uuid REFERENCES platform_contract_templates(id) ON DELETE SET NULL,
  version         text,
  title           text,
  body_html       text,                 -- snapshot renderizado no aceite/criação
  body_hash       text,                 -- sha256 do snapshot
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','canceled')),
  accepted_at     timestamptz,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_name text,
  accepted_by_doc  text,
  signer_ip       inet,
  signer_user_agent text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_contracts_org_idx ON platform_contracts (organization_id, status);

DROP TRIGGER IF EXISTS tg_platform_contracts_updated_at ON platform_contracts;
CREATE TRIGGER tg_platform_contracts_updated_at BEFORE UPDATE ON platform_contracts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- master + a própria empresa (lê/aceita o seu)
ALTER TABLE platform_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_contracts_rls ON platform_contracts;
CREATE POLICY platform_contracts_rls ON platform_contracts FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE platform_contract_templates IS 'Modelos de contrato master↔empresa (onboarding/aditivo/serviço extra).';
COMMENT ON TABLE platform_contracts IS 'Contratos master↔empresa aceitos via clickwrap (snapshot + hash + IP/UA).';
