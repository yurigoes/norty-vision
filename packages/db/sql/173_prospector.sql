-- ==============================================================================
-- 173_prospector.sql  (idempotente)  —  Motor de prospecção de leads (Fase A.5)
-- Busca leads B2B em fontes públicas grátis (1ª fonte: OpenStreetMap/Overpass).
-- Resultados viram crm_lead (fila "Leads novos"). Respeita opt-out (LGPD).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS prospect_campaign (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  source           text NOT NULL DEFAULT 'osm',         -- osm (depois: cnpj)
  osm_filters      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{k,v}] ex.: {"k":"shop","v":"optician"}
  city             text,
  state            text,
  limit_per_run    int  NOT NULL DEFAULT 50,
  frequency        text NOT NULL DEFAULT 'manual',       -- manual | daily | weekly
  auto_create_lead boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  last_count       int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prospect_campaign_org ON prospect_campaign (organization_id, active);
ALTER TABLE prospect_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_campaign FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_campaign_rls ON prospect_campaign;
CREATE POLICY prospect_campaign_rls ON prospect_campaign FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS prospect_result (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id      uuid NOT NULL REFERENCES prospect_campaign(id) ON DELETE CASCADE,
  source           text NOT NULL DEFAULT 'osm',
  external_ref     text,                                 -- id na fonte (ex.: osm node id)
  name             text NOT NULL,
  phone            text,
  email            text,
  website          text,
  address          text,
  raw              jsonb,
  dedupe_key       text NOT NULL,
  status           text NOT NULL DEFAULT 'novo',          -- novo | virou_lead | descartado
  lead_id          uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prospect_result_camp ON prospect_result (campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospect_result_dedupe ON prospect_result (organization_id, dedupe_key);
ALTER TABLE prospect_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_result FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_result_rls ON prospect_result;
CREATE POLICY prospect_result_rls ON prospect_result FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS prospect_optout (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'phone',         -- phone | cnpj
  value            text NOT NULL,
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospect_optout ON prospect_optout (organization_id, value);
ALTER TABLE prospect_optout ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_optout FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_optout_rls ON prospect_optout;
CREATE POLICY prospect_optout_rls ON prospect_optout FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
