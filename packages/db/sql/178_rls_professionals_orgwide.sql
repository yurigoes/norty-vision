-- ==============================================================================
-- 178_rls_professionals_orgwide.sql
-- Profissionais sao visiveis pra TODOS da mesma org, nao filtra por store_id
-- na leitura. Agenda eh recurso compartilhado: recepcao/vendedor de qualquer
-- loja precisa enxergar todos os profissionais pra agendar.
--
-- A escrita (WITH CHECK) continua restrita a admin ou store_id da loja certa,
-- pra evitar criar profissional em loja errada.
-- ==============================================================================

DROP POLICY IF EXISTS professionals_tenant ON professionals;
CREATE POLICY professionals_tenant ON professionals
  FOR ALL
  USING (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND (app.is_org_admin() OR store_id = app.current_store_id())
    )
  );
