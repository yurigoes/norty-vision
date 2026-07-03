-- ==============================================================================
-- 016_fix_roles_unique.sql
-- Corrige roles duplicados: UNIQUE (org_id, slug) trata NULL como distinto.
-- Trocar pra NULLS NOT DISTINCT (Postgres 15+) e deduplicar registros existentes.
-- ==============================================================================

-- 1. dedupe: mantem o id mais antigo de cada (organization_id, slug)
WITH dupes AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id, slug ORDER BY created_at, id
         ) AS rn
    FROM roles
)
DELETE FROM roles WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- 2. dropa constraint antiga e recria com NULLS NOT DISTINCT
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'roles'::regclass
     AND contype  = 'u'
     AND pg_get_constraintdef(oid) LIKE '%(organization_id, slug)%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE roles DROP CONSTRAINT %I', con_name);
  END IF;
END
$$;

ALTER TABLE roles
  ADD CONSTRAINT roles_org_slug_unique
  UNIQUE NULLS NOT DISTINCT (organization_id, slug);

-- 3. re-seed (agora idempotente)
INSERT INTO roles (slug, name, description, permissions, is_default, is_system, organization_id)
SELECT slug, name, description, permissions, is_default, is_system, NULL
  FROM (VALUES
    ('owner','Proprietario','Acesso total a organizacao, incluindo billing e exclusao.',
     '{"billing":{"read":"org","write":"org"},"organization":{"read":"org","write":"org"},"stores":{"read":"org","write":"org"},"users":{"read":"org","write":"org"},"appointments":{"read":"org","write":"org"},"leads":{"read":"org","write":"org"},"campaigns":{"read":"org","write":"org"},"audit_log":{"read":"org","write":"none"}}'::jsonb,
     false, true)
  ) AS t(slug,name,description,permissions,is_default,is_system)
ON CONFLICT (organization_id, slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  permissions = EXCLUDED.permissions, is_default = EXCLUDED.is_default,
  is_system = EXCLUDED.is_system, updated_at = now();
