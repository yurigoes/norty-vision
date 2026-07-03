-- ==============================================================================
-- 000_roles.sql
-- Roles do Postgres (separados dos roles da aplicacao em 'roles' table).
-- Roda apenas 1x no bootstrap; precisa SUPERUSER (postgres role).
--
-- Recebe parametros via psql -v:
--   -v yugo_app_password='...'
--   -v yugo_migrator_password='...'
--
-- Implementacao: variaveis psql nao funcionam dentro de DO $$ blocks,
-- entao usamos o padrao SELECT ... \gexec que gera DDL dinamico.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- yugo_app: role usado pela API. Respeita RLS.
-- ------------------------------------------------------------------------------
SELECT format(
  'CREATE ROLE yugo_app LOGIN PASSWORD %L NOSUPERUSER',
  :'yugo_app_password'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yugo_app')
\gexec

-- atualiza senha (caso ja existisse com outra senha)
SELECT format('ALTER ROLE yugo_app WITH PASSWORD %L', :'yugo_app_password')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'yugo_app')
\gexec

-- ------------------------------------------------------------------------------
-- yugo_migrator: BYPASSRLS para migrations e seed
-- ------------------------------------------------------------------------------
SELECT format(
  'CREATE ROLE yugo_migrator LOGIN PASSWORD %L NOSUPERUSER BYPASSRLS',
  :'yugo_migrator_password'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yugo_migrator')
\gexec

SELECT format('ALTER ROLE yugo_migrator WITH PASSWORD %L BYPASSRLS', :'yugo_migrator_password')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'yugo_migrator')
\gexec

-- ------------------------------------------------------------------------------
-- Schema app (caso nao exista; 001_extensions cria, mas garantimos pra grants)
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

-- ------------------------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO yugo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yugo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yugo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_app;

-- default privileges pra tabelas/sequencias criadas no futuro
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO yugo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO yugo_app;

GRANT ALL ON SCHEMA public, app TO yugo_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO yugo_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO yugo_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO yugo_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO yugo_migrator;
