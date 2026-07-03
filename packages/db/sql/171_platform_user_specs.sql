-- ==============================================================================
-- 171_platform_user_specs.sql  (idempotente)  —  acesso às Specs por usuário master
-- Quais categorias de Specs Técnicas cada usuário da plataforma pode ver.
-- '{*}' = todas (padrão; mantém o acesso atual de quem já existe).
-- ==============================================================================

ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS tech_specs_categories text[] NOT NULL DEFAULT '{*}';
