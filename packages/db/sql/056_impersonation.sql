-- ==============================================================================
-- 056_impersonation.sql
-- Impersonação do master: o master "entra" no painel de uma empresa como se
-- fosse um usuário dela (visualizar/gerenciar). A sessão master guarda qual
-- organização está sendo impersonada; ao limpar, volta ao modo master.
-- ==============================================================================

ALTER TABLE platform_sessions
  ADD COLUMN IF NOT EXISTS impersonating_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
