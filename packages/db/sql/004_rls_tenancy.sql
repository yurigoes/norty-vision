-- ==============================================================================
-- 004_rls_tenancy.sql
-- Row-Level Security para tabelas de tenancy.
-- Ver docs/adr/0002-rls-strategy.md
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ORGANIZATIONS
-- user normal: ve so as orgs dos seus memberships ativos.
-- platform admin: ve tudo.
-- ------------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR id = app.current_org_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.user_id = app.current_user_id()
         AND m.organization_id = organizations.id
         AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS organizations_update ON organizations;
CREATE POLICY organizations_update ON organizations
  FOR UPDATE
  USING (
    app.is_platform_admin()
    OR (
      id = app.current_org_id()
      AND app.is_org_admin()
    )
  );

DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations
  FOR INSERT
  WITH CHECK (app.is_platform_admin());
  -- so platform admin cria org via API; signup self-service usa role especial.

DROP POLICY IF EXISTS organizations_delete ON organizations;
CREATE POLICY organizations_delete ON organizations
  FOR DELETE
  USING (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- STORES
-- ------------------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select ON stores;
CREATE POLICY stores_select ON stores
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND (
        app.is_org_admin()
        OR id = app.current_store_id()
        OR EXISTS (
          SELECT 1 FROM memberships m
           WHERE m.user_id = app.current_user_id()
             AND m.store_id = stores.id
             AND m.status = 'active'
        )
      )
    )
  );

DROP POLICY IF EXISTS stores_modify ON stores;
CREATE POLICY stores_modify ON stores
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  );

-- ------------------------------------------------------------------------------
-- USERS
-- user normal: ve apenas a si proprio + outros users do mesmo membership scope.
-- ------------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self ON users;
CREATE POLICY users_select_self ON users
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR id = app.current_user_id()
    OR EXISTS (
      -- user pode ver outros que compartilhem org (pra listar membros)
      SELECT 1 FROM memberships m1
       JOIN memberships m2 ON m2.organization_id = m1.organization_id
       WHERE m1.user_id = app.current_user_id()
         AND m1.status = 'active'
         AND m2.user_id = users.id
         AND m2.status = 'active'
    )
  );

DROP POLICY IF EXISTS users_update_self ON users;
CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (
    app.is_platform_admin()
    OR id = app.current_user_id()
  );

-- inserts apenas via API com role yugo_migrator ou via signup flow especial.
DROP POLICY IF EXISTS users_insert_blocked ON users;
CREATE POLICY users_insert_blocked ON users
  FOR INSERT
  WITH CHECK (app.is_platform_admin());

DROP POLICY IF EXISTS users_delete_blocked ON users;
CREATE POLICY users_delete_blocked ON users
  FOR DELETE
  USING (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- MEMBERSHIPS
-- user ve so os seus proprios memberships + admin de org ve todos da org.
-- ------------------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_select ON memberships;
CREATE POLICY memberships_select ON memberships
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR user_id = app.current_user_id()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  );

DROP POLICY IF EXISTS memberships_modify ON memberships;
CREATE POLICY memberships_modify ON memberships
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
    )
  );

-- ------------------------------------------------------------------------------
-- ROLES
-- roles globais (organization_id IS NULL): leitura aberta, escrita platform only.
-- roles da org: leitura/escrita pra admin da org.
-- ------------------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = app.current_org_id()
    OR app.is_platform_admin()
  );

DROP POLICY IF EXISTS roles_modify ON roles;
CREATE POLICY roles_modify ON roles
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
      AND is_system = false
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND app.is_org_admin()
      AND is_system = false
    )
  );

-- ------------------------------------------------------------------------------
-- SESSIONS - so o proprio user le suas sessoes
-- ------------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_self ON sessions;
CREATE POLICY sessions_self ON sessions
  FOR ALL
  USING (
    app.is_platform_admin()
    OR user_id = app.current_user_id()
  )
  WITH CHECK (
    app.is_platform_admin()
    OR user_id = app.current_user_id()
  );

-- ------------------------------------------------------------------------------
-- PLATFORM_USERS - so platform_admin
-- ------------------------------------------------------------------------------
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_users_only ON platform_users;
CREATE POLICY platform_users_only ON platform_users
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());
