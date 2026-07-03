-- ==============================================================================
-- 052_platform_user_chatwoot.sql
-- Vincula o usuário master a um usuário Chatwoot, pra ele logar via SSO e ser
-- adicionado como ADMINISTRATOR em todas as contas provisionadas.
-- ==============================================================================

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS chatwoot_user_id text;
