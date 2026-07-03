-- ==============================================================================
-- 062_user_perms_role_active.sql
-- - memberships.permissions: overrides de permissão POR USUÁRIO (sobre o papel).
-- - roles.is_active: permite INATIVAR um papel sem apagar.
-- ==============================================================================

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
