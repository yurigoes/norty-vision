-- ==============================================================================
-- 001_extensions.sql
-- Extensoes do Postgres + schema 'app' com utilitarios.
-- Idempotente: rodavel multiplas vezes sem efeitos colaterais.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;          -- case-insensitive text (emails)
CREATE EXTENSION IF NOT EXISTS pg_trgm;         -- busca fuzzy (intent matching, nomes)
CREATE EXTENSION IF NOT EXISTS btree_gin;       -- indices compostos GIN
CREATE EXTENSION IF NOT EXISTS unaccent;        -- normalizacao de busca PT-BR
CREATE EXTENSION IF NOT EXISTS vector;          -- embeddings / RAG semantico (IA Fase 2b)

-- ------------------------------------------------------------------------------
-- schema dedicado para helpers da plataforma (separa de 'public')
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

-- ------------------------------------------------------------------------------
-- gerador de UUID (centralizado pra trocar v4->v7 quando precisar)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.new_id() RETURNS uuid
  LANGUAGE sql
  PARALLEL SAFE
  AS $$ SELECT gen_random_uuid(); $$;

COMMENT ON FUNCTION app.new_id IS
  'Default gerador de UUID. Substituir corpo por uuid_v7() quando passar de ~1M rows/tabela.';

-- ------------------------------------------------------------------------------
-- trigger pra atualizar updated_at automaticamente
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- helpers de contexto RLS (sempre lidos via current_setting com fallback)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_store_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.store_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.is_org_admin() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(current_setting('app.is_org_admin', true), 'false') = 'true';
$$;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true';
$$;

-- ------------------------------------------------------------------------------
-- short_code generator (Base32 Crockford-like, 8 chars)
-- usado em URLs publicas curtas (confirmar agendamento etc.)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.short_code(len int DEFAULT 8) RETURNS text
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- sem I, L, O, U (ambiguidade)
  result text := '';
  i int;
BEGIN
  FOR i IN 1..len LOOP
    result := result || substr(alphabet, 1 + (random() * 31)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION app.short_code IS
  'Gera codigo curto Base32 Crockford-like para URLs publicas (ex: /confirm/AB12CDEF). Unicidade garantida por UNIQUE index na coluna que usa.';
