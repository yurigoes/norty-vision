-- ==============================================================================
-- 050_user_must_reset.sql
-- Troca de senha obrigatória no 1º acesso do staff da empresa.
-- Default false: usuários existentes NÃO são afetados; apenas novos usuários
-- (criados pelo admin) ou após reset começam com a flag = true.
-- ==============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false;
