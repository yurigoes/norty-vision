-- ==============================================================================
-- 034_platform_roles.sql
-- Papel do master da plataforma: 'owner' (dono do SaaS, faz tudo incluindo a
-- configuracao do proprio SaaS) ou 'support' (suporte master, opera qualquer
-- empresa mas NAO acessa a configuracao do dono: identidade/branding, planos,
-- credenciais/cofre e integracoes da plataforma).
-- ==============================================================================

ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner'
  CHECK (role IN ('owner', 'support'));

COMMENT ON COLUMN platform_users.role IS
  'owner = dono do SaaS (acesso total); support = suporte master (qualquer empresa, exceto config do dono).';
