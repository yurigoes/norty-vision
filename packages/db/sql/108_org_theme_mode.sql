-- ==============================================================================
-- 108_org_theme_mode.sql  (idempotente)
--
-- Tema (claro/escuro) escolhido no cadastro da EMPRESA. Quando definido como
-- 'light' ou 'dark', passa a ser predominante em todo o slug da empresa
-- (vitrine no subdomínio + portais do cliente/funcionário/fornecedor), a menos
-- que o visitante troque manualmente pelo toggle. 'system' = sem override.
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS theme_mode text NOT NULL DEFAULT 'system';
