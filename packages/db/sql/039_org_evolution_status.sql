-- ==============================================================================
-- 039_org_evolution_status.sql
-- A instancia Evolution passa a ser POR EMPRESA, identificada pelo slug da org
-- (ex.: 'zito-oticas'). Guardamos o status da conexao no nivel da organizacao.
-- ==============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS evolution_status text;

COMMENT ON COLUMN organizations.evolution_status IS
  'Status da instancia WhatsApp (Evolution) da empresa. Instancia = slug da org.';
