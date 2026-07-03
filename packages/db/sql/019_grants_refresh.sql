-- ==============================================================================
-- 019_grants_refresh.sql
-- Reaplica GRANTs em todas as tabelas/sequencias/funcoes pra yugo_app.
--
-- Default privileges so afetam objetos CRIADOS DEPOIS pelo role que rodou
-- ALTER DEFAULT PRIVILEGES. Como tabelas foram criadas por yugo_migrator
-- (que tinha permissoes implicitas), tabelas posteriores (platform_sessions,
-- platform_settings, etc) podem nao ter herdado.
--
-- Roda como super-user (postgres role). db-apply.sh ja invoca como super-user.
-- ==============================================================================

GRANT USAGE ON SCHEMA public, app TO yugo_app, yugo_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yugo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yugo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yugo_app;

GRANT ALL ON ALL TABLES IN SCHEMA public TO yugo_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO yugo_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yugo_migrator;

-- garante que tabelas/sequencias futuras CRIADAS por yugo_migrator tambem
-- herdem as permissoes pra yugo_app
ALTER DEFAULT PRIVILEGES FOR ROLE yugo_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE yugo_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO yugo_app;
