-- ==============================================================================
-- 112_org_portal_config.sql  (idempotente)
--
-- Configuração de quais recursos/botões aparecem no PORTAL DO CLIENTE de cada
-- empresa (crediário, OS, pedidos, chamados, contratos...). null = padrão
-- (mostra todos). O admin da empresa e o master (por empresa) configuram.
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS portal_config jsonb;
