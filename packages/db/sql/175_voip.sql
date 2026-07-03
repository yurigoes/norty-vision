-- ==============================================================================
-- 175_voip.sql  (idempotente)  —  VoIP interno (Fase B.2): ramais + chamadas
-- Ramal por operador (WebRTC/SIP) e registro de chamadas (entra na timeline do CRM).
-- Ligação ramal↔ramal interna grátis; PSTN só na Fase C (trunk).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS voip_extension (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid,
  extension       text NOT NULL,                 -- ramal (ex.: 1001)
  secret          text NOT NULL,                 -- senha SIP do ramal
  display_name    text,                          -- nome que aparece ao ligar
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_ext_org_num ON voip_extension (organization_id, extension);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_ext_member ON voip_extension (membership_id);
ALTER TABLE voip_extension ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_extension FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_ext_rls ON voip_extension;
CREATE POLICY voip_ext_rls ON voip_extension FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS voip_call (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id         uuid,
  direction       text NOT NULL DEFAULT 'internal',  -- internal | inbound | outbound
  from_ext        text,
  to_ext          text,
  to_number       text,
  caller_name     text,
  callee_name     text,
  status          text NOT NULL DEFAULT 'ringing',   -- ringing | answered | ended | missed | failed
  started_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  duration_s      int,
  recording_url   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voip_call_org ON voip_call (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_voip_call_lead ON voip_call (lead_id);
ALTER TABLE voip_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_call FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_call_rls ON voip_call;
CREATE POLICY voip_call_rls ON voip_call FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
