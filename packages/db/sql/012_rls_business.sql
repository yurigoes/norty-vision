-- ==============================================================================
-- 012_rls_business.sql
-- RLS para todas as tabelas de negocio (catalog, scheduling, NLU, leads,
-- campaigns, audit, help/guide/specs).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- helper: gera policy padrao "mesmo org + (loja bate OU is_org_admin)"
-- Aplicamos manualmente em cada tabela; este script eh apenas declarativo.
-- ------------------------------------------------------------------------------

-- CUSTOMERS ---------------------------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_tenant ON customers;
CREATE POLICY customers_tenant ON customers
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND (store_id = app.current_store_id() OR app.is_org_admin())
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND store_id = app.current_store_id()
    )
  );

-- PROFESSIONALS -----------------------------------------------------------
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professionals_tenant ON professionals;
CREATE POLICY professionals_tenant ON professionals
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND (store_id = app.current_store_id() OR app.is_org_admin())
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND store_id = app.current_store_id()
    )
  );

-- CUSTOMER_NOTES (privadas so quem escreveu) ------------------------------
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_notes_tenant ON customer_notes;
CREATE POLICY customer_notes_tenant ON customer_notes
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND (store_id = app.current_store_id() OR app.is_org_admin())
      AND (is_private = false OR created_by = app.current_user_id() OR app.is_org_admin())
    )
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (
      organization_id = app.current_org_id()
      AND store_id = app.current_store_id()
    )
  );

-- SCHEDULE_TEMPLATES ------------------------------------------------------
ALTER TABLE schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_templates_tenant ON schedule_templates;
CREATE POLICY schedule_templates_tenant ON schedule_templates
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- SCHEDULE_SLOTS ----------------------------------------------------------
ALTER TABLE schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_slots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_slots_tenant ON schedule_slots;
CREATE POLICY schedule_slots_tenant ON schedule_slots
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- APPOINTMENTS ------------------------------------------------------------
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_tenant ON appointments;
CREATE POLICY appointments_tenant ON appointments
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- APPOINTMENT_EVENTS (read-only sob policy; insert via app) ---------------
ALTER TABLE appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_events_tenant ON appointment_events;
CREATE POLICY appointment_events_tenant ON appointment_events
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- INTENT_KEYWORDS (heranca multi-escopo) ----------------------------------
ALTER TABLE intent_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_keywords FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intent_keywords_read ON intent_keywords;
CREATE POLICY intent_keywords_read ON intent_keywords
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR organization_id IS NULL                           -- global
    OR organization_id = app.current_org_id()
  );

DROP POLICY IF EXISTS intent_keywords_write ON intent_keywords;
CREATE POLICY intent_keywords_write ON intent_keywords
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
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

-- MESSAGE_LOG -------------------------------------------------------------
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_log_tenant ON message_log;
CREATE POLICY message_log_tenant ON message_log
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- UNRESOLVED_REPLIES ------------------------------------------------------
ALTER TABLE unresolved_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE unresolved_replies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unresolved_replies_tenant ON unresolved_replies;
CREATE POLICY unresolved_replies_tenant ON unresolved_replies
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND store_id = app.current_store_id())
  );

-- LEAD_PIPELINES / LEAD_STAGES / LEADS / LEAD_EVENTS -----------------------
ALTER TABLE lead_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_pipelines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_pipelines_tenant ON lead_pipelines;
CREATE POLICY lead_pipelines_tenant ON lead_pipelines
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

ALTER TABLE lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_stages_tenant ON lead_stages;
CREATE POLICY lead_stages_tenant ON lead_stages
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_tenant ON leads;
CREATE POLICY leads_tenant ON leads
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_events_tenant ON lead_events;
CREATE POLICY lead_events_tenant ON lead_events
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

-- CAMPAIGN_TEMPLATES / CAMPAIGNS / CAMPAIGN_TARGETS ------------------------
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_templates_tenant ON campaign_templates;
CREATE POLICY campaign_templates_tenant ON campaign_templates
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id()
        AND (store_id IS NULL OR store_id = app.current_store_id() OR app.is_org_admin()))
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND (store_id IS NULL OR store_id = app.current_store_id()))
  );

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_tenant ON campaigns;
CREATE POLICY campaigns_tenant ON campaigns
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

ALTER TABLE campaign_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_targets_tenant ON campaign_targets;
CREATE POLICY campaign_targets_tenant ON campaign_targets
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND (store_id = app.current_store_id() OR app.is_org_admin())))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND store_id = app.current_store_id()));

-- AUDIT_LOG / DATA_ACCESS_LOG --------------------------------------------
-- audit_log: org admin ve da sua org; platform ve tudo
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_read ON audit_log;
CREATE POLICY audit_log_read ON audit_log
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (true);   -- qualquer sessao pode inserir; o UPDATE/DELETE e bloqueado por trigger

ALTER TABLE data_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_access_log_read ON data_access_log;
CREATE POLICY data_access_log_read ON data_access_log
  FOR SELECT
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

DROP POLICY IF EXISTS data_access_log_insert ON data_access_log;
CREATE POLICY data_access_log_insert ON data_access_log
  FOR INSERT
  WITH CHECK (true);

-- HELP_ARTICLES (publico pra users logados) ------------------------------
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_articles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS help_articles_read ON help_articles;
CREATE POLICY help_articles_read ON help_articles
  FOR SELECT
  USING (
    is_published = true
    AND (organization_id IS NULL OR organization_id = app.current_org_id())
  );

DROP POLICY IF EXISTS help_articles_write ON help_articles;
CREATE POLICY help_articles_write ON help_articles
  FOR ALL
  USING (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  )
  WITH CHECK (
    app.is_platform_admin()
    OR (organization_id = app.current_org_id() AND app.is_org_admin())
  );

-- SYSTEM_GUIDE_SECTIONS (publico pra users logados, edit so platform) ----
ALTER TABLE system_guide_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_guide_sections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_guide_read ON system_guide_sections;
CREATE POLICY system_guide_read ON system_guide_sections
  FOR SELECT
  USING (is_published = true OR app.is_platform_admin());

DROP POLICY IF EXISTS system_guide_write ON system_guide_sections;
CREATE POLICY system_guide_write ON system_guide_sections
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- TECH_SPEC_DOCUMENTS (RESTRITO) -----------------------------------------
ALTER TABLE tech_spec_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_spec_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_spec_read ON tech_spec_documents;
CREATE POLICY tech_spec_read ON tech_spec_documents
  FOR SELECT
  USING (
    is_published = true
    AND app.has_tech_specs_access()
  );

DROP POLICY IF EXISTS tech_spec_write ON tech_spec_documents;
CREATE POLICY tech_spec_write ON tech_spec_documents
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- TECH_SPEC_ACCESS_GRANTS (so platform_admin gerencia; user le os seus) ---
ALTER TABLE tech_spec_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_spec_access_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_spec_grants_admin ON tech_spec_access_grants;
CREATE POLICY tech_spec_grants_admin ON tech_spec_access_grants
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

DROP POLICY IF EXISTS tech_spec_grants_self ON tech_spec_access_grants;
CREATE POLICY tech_spec_grants_self ON tech_spec_access_grants
  FOR SELECT
  USING (user_id = app.current_user_id() OR app.is_platform_admin());

-- TECH_SPEC_ACCESS_LOG ----------------------------------------------------
ALTER TABLE tech_spec_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_spec_access_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_spec_log_read ON tech_spec_access_log;
CREATE POLICY tech_spec_log_read ON tech_spec_access_log
  FOR SELECT
  USING (app.is_platform_admin());

DROP POLICY IF EXISTS tech_spec_log_insert ON tech_spec_access_log;
CREATE POLICY tech_spec_log_insert ON tech_spec_access_log
  FOR INSERT
  WITH CHECK (true);
