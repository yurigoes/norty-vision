-- ==============================================================================
-- 094_evolution_instances.sql  (idempotente)
--
-- Múltiplas instâncias de WhatsApp (Evolution) por empresa.
--
-- A instância PRINCIPAL continua sendo o slug da org (colunas evolution_* em
-- organizations) e faz TODAS as notificações (agenda, cobrança, pesquisa, etc).
-- As instâncias EXTRAS aqui são exclusivas do CALL CENTER: recebem mensagens
-- novas e enviam respostas pelo atendimento (empresas com mais de um número).
-- Cada extra fica atrelada a uma inbox (channel_ref = nome da instância).
--
-- max_extra_whatsapp em organizations limita quantas extras a empresa pode criar
-- (definido pelo master conforme o plano; 0 = só a principal).
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_extra_whatsapp int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS evolution_instances (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,            -- nome técnico único na Evolution (ex.: slug-2)
  label           text,                     -- rótulo amigável ("Loja Centro", "Vendas")
  role            text NOT NULL DEFAULT 'inbound' CHECK (role IN ('principal','inbound')),
  status          text,                     -- null|qr_required|connected|disconnected|failed
  qr              text,
  inbox_id        uuid REFERENCES inboxes(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS evolution_instances_org_idx ON evolution_instances (organization_id);
CREATE INDEX IF NOT EXISTS evolution_instances_name_idx ON evolution_instances (name);
DROP TRIGGER IF EXISTS tg_evolution_instances_updated_at ON evolution_instances;
CREATE TRIGGER tg_evolution_instances_updated_at BEFORE UPDATE ON evolution_instances
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE evolution_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evolution_instances_rls ON evolution_instances;
CREATE POLICY evolution_instances_rls ON evolution_instances FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
