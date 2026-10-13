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
--
-- ATENCAO A ORDEM: este arquivo e o 019 de 214. `GRANT ... ON ALL TABLES` so
-- alcanca o que JA EXISTE quando ele roda — as 195 migrations seguintes criam
-- tabelas que ele nao ve. Por isso os dois `db-apply*.sh` rodam este arquivo
-- DE NOVO no fim, depois de todas as migrations. E ele e idempotente de
-- proposito: rodar duas vezes nao faz nada de errado.
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

-- ==============================================================================
-- E PRA QUEM CRIA AS TABELAS DE VERDADE: postgres.
--
-- As linhas acima cobrem só o que `yugo_migrator` cria. Mas o
-- `db-apply-nv-thor.sh` aplica TODA migration como `postgres`
-- (`psql -U postgres`), e o `000_roles.sql` roda
-- `ALTER DEFAULT PRIVILEGES` SEM `FOR ROLE` — o que registra o padrão apenas
-- para o papel que executou aquele arquivo. Onde essa rede não pegou, tabela
-- criada depois nasce SEM permissão nenhuma pro yugo_app, e a API responde:
--
--     PostgresError 42501: permission denied for table ponto_employer
--     at PontoService.consumeNsr -> punchCore -> PontoPwaService.punch
--     POST /api/ponto-pwa/punch -> 500
--
-- Foi isso que parou o ponto da produção: o `consumeNsr` incrementa o NSR por
-- empregador, então NENHUMA batida conseguia número. Reproduzido aqui
-- apontando a API pro papel `yugo_app` e revogando a tabela: 500 idêntico,
-- mesma linha de log. Com os GRANTs reaplicados: 200, NSR na sequência.
-- ==============================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO yugo_app;
