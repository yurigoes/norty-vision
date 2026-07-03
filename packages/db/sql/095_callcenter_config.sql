-- ==============================================================================
-- 095_callcenter_config.sql  (idempotente)
--
-- Configurações do Call Center:
--   memberships.inbox_display_name — nome que o cliente vê nas respostas (override
--                                    do nome do usuário). Ex.: "Yuri (Vendas)".
--   call_center_settings           — SLA por org: minutos-alvo de espera do
--                                    cliente e de resposta do operador (selo/cores).
-- ==============================================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS inbox_display_name text;

CREATE TABLE IF NOT EXISTS call_center_settings (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sla_customer_min  int NOT NULL DEFAULT 10,   -- cliente aguardando (alvo)
  sla_agent_min     int NOT NULL DEFAULT 2,    -- resposta do operador (alvo)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);
DROP TRIGGER IF EXISTS tg_call_center_settings_updated_at ON call_center_settings;
CREATE TRIGGER tg_call_center_settings_updated_at BEFORE UPDATE ON call_center_settings
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE call_center_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_center_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_center_settings_rls ON call_center_settings;
CREATE POLICY call_center_settings_rls ON call_center_settings FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
