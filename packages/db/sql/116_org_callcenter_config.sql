-- ==============================================================================
-- 116_org_callcenter_config.sql  (idempotente)
--
-- Configuração botão-a-botão das ações do módulo de Atendimento (call center)
-- por empresa: quais botões aparecem (ex.: Vender, Agenda). null = padrão
-- (segue os módulos habilitados). Admin da empresa e master (por empresa) ajustam.
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS callcenter_config jsonb;
