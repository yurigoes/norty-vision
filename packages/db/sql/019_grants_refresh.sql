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
--
-- ------------------------------------------------------------------------------
-- POR QUE TUDO ISTO ESTA DENTRO DE UM DO BLOCK
--
-- A versao anterior abria com:
--
--     GRANT USAGE ON SCHEMA public, app TO yugo_app, yugo_migrator;
--
-- e morria na primeira linha em qualquer banco que nao tenha `yugo_migrator`:
--
--     psql:/tmp/grants.sql:19: ERROR:  role "yugo_migrator" does not exist
--
-- Que e exatamente o caso da producao na thor. O banco de la nasceu de um
-- `pg_restore` e TODA migration e aplicada como `postgres` (veja o
-- `db-apply-nv-thor.sh`): `yugo_migrator` nunca foi criado porque nunca foi
-- usado. O `000_roles.sql`, que o criaria, e bootstrap e pede duas senhas por
-- `-v`, entao nao roda no laco das migrations.
--
-- O resultado era o pior possivel: as migrations entravam, e o reparo de
-- GRANTs — a unica coisa que cobre tabela nova — morria na linha 1. Com
-- `ON_ERROR_STOP=1`, NADA depois da linha 19 era aplicado. Banco com tabela
-- nova e sem permissao e precisamente o estado que derrubou o ponto em
-- outubro (42501 em `ponto_employer`, dentro do `consumeNsr`).
--
-- Agora cada GRANT depende do papel existir:
--   · `yugo_app` AUSENTE  -> erro. A API usa esse papel; sem ele o banco esta
--     quebrado pra este sistema, e seguir calado seria esconder isso.
--   · `yugo_migrator` AUSENTE -> aviso e segue. E opcional por desenho: onde as
--     migrations rodam como `postgres`, ele nao tem funcao.
-- ==============================================================================

DO $grants$
DECLARE
  tem_app      boolean := exists (select 1 from pg_roles where rolname = 'yugo_app');
  tem_migrator boolean := exists (select 1 from pg_roles where rolname = 'yugo_migrator');
  tem_schema   boolean := exists (select 1 from pg_namespace where nspname = 'app');
BEGIN
  IF NOT tem_app THEN
    RAISE EXCEPTION 'papel yugo_app nao existe neste banco — a API autentica com ele e nao subiria. Rode o 000_roles.sql (pede -v yugo_app_password) antes deste arquivo.';
  END IF;

  IF NOT tem_migrator THEN
    RAISE NOTICE 'papel yugo_migrator nao existe — pulando os GRANTs dele (normal onde as migrations rodam como postgres)';
  END IF;

  IF NOT tem_schema THEN
    RAISE NOTICE 'schema app nao existe — pulando os GRANTs dele';
  END IF;

  -- --- yugo_app: le e escreve, respeitando RLS -------------------------------
  EXECUTE 'GRANT USAGE ON SCHEMA public TO yugo_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yugo_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yugo_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yugo_app';
  IF tem_schema THEN
    EXECUTE 'GRANT USAGE ON SCHEMA app TO yugo_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_app';
  END IF;

  -- --- yugo_migrator: tudo, e BYPASSRLS vem do proprio papel -----------------
  IF tem_migrator THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO yugo_migrator';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA public TO yugo_migrator';
    EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO yugo_migrator';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yugo_migrator';
    IF tem_schema THEN
      EXECUTE 'GRANT USAGE ON SCHEMA app TO yugo_migrator';
      EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO yugo_migrator';
    END IF;
  END IF;

  -- --- e o que for CRIADO DEPOIS -------------------------------------------
  -- `ALTER DEFAULT PRIVILEGES FOR ROLE x` exige ser membro de x, entao confere
  -- antes: rodar este arquivo como um papel comum avisa em vez de estourar.
  IF tem_migrator AND pg_has_role(current_user, 'yugo_migrator', 'USAGE') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE yugo_migrator IN SCHEMA public
               GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE yugo_migrator IN SCHEMA public
               GRANT USAGE, SELECT ON SEQUENCES TO yugo_app';
  END IF;

  -- E PRA QUEM CRIA AS TABELAS DE VERDADE NA THOR: postgres.
  --
  -- O `db-apply-nv-thor.sh` aplica TODA migration como `postgres`
  -- (`psql -U postgres`), e o `000_roles.sql` chama `ALTER DEFAULT PRIVILEGES`
  -- SEM `FOR ROLE` — o que registra o padrao apenas para o papel que executou
  -- aquele arquivo. Onde essa rede nao pegou, tabela criada depois nasce SEM
  -- permissao nenhuma pro yugo_app, e a API responde:
  --
  --     PostgresError 42501: permission denied for table ponto_employer
  --     at PontoService.consumeNsr -> punchCore -> PontoPwaService.punch
  --     POST /api/ponto-pwa/punch -> 500
  --
  -- Foi isso que parou o ponto da producao: o `consumeNsr` incrementa o NSR por
  -- empregador, entao NENHUMA batida conseguia numero. Reproduzido aqui
  -- apontando a API pro papel `yugo_app` e revogando a tabela: 500 identico,
  -- mesma linha de log. Com os GRANTs reaplicados: 200, NSR na sequencia.
  IF exists (select 1 from pg_roles where rolname = 'postgres')
     AND pg_has_role(current_user, 'postgres', 'USAGE') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
               GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
               GRANT USAGE, SELECT ON SEQUENCES TO yugo_app';
  END IF;

  -- e tambem pro papel que esta rodando ESTE arquivo, seja ele qual for: e ele
  -- que vai criar a proxima tabela se as migrations forem aplicadas por outro
  -- usuario qualquer.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yugo_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT USAGE, SELECT ON SEQUENCES TO yugo_app';
END
$grants$;
