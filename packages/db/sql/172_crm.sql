-- ==============================================================================
-- 172_crm.sql  (idempotente)  —  CENTRAL DE ATENDIMENTO / CRM (Fase A)
-- Lead (contato comercial) com dono, etapa do funil, score e LINHA DO TEMPO.
-- Reaproveita inbox (conversa/protocolo), customers e a tabulação do inbox.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS crm_lead (
  id                   uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id             uuid,
  customer_id          uuid,
  conversation_id      uuid,
  name                 text NOT NULL,
  phone                text,
  email                text,
  source               text NOT NULL DEFAULT 'manual',   -- whatsapp|webchat|email|site|import|manual|prospector
  stage                text NOT NULL DEFAULT 'novo',      -- novo|em_contato|qualificado|proposta|negociacao|ganho|perdido
  status               text NOT NULL DEFAULT 'aberto',    -- aberto|ganho|perdido
  owner_membership_id  uuid,
  score                int  NOT NULL DEFAULT 0,
  lost_reason          text,
  tabulation           text,                              -- última tabulação (resumo)
  protocol             text,
  tags                 text[] NOT NULL DEFAULT '{}',
  next_action_at       timestamptz,
  last_event_at        timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_crm_lead_stage ON crm_lead (organization_id, stage, last_event_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_lead_owner ON crm_lead (organization_id, owner_membership_id);
CREATE INDEX IF NOT EXISTS ix_crm_lead_phone ON crm_lead (organization_id, phone);
CREATE INDEX IF NOT EXISTS ix_crm_lead_status ON crm_lead (organization_id, status);
ALTER TABLE crm_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_lead_rls ON crm_lead;
CREATE POLICY crm_lead_rls ON crm_lead FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS crm_lead_event (
  id                   uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id              uuid NOT NULL REFERENCES crm_lead(id) ON DELETE CASCADE,
  kind                 text NOT NULL,   -- system|whatsapp_in|whatsapp_out|email|call|note|task|task_done|tabulation|stage_change|assigned|sale|quote
  title                text NOT NULL,
  body                 text,
  author_membership_id uuid,
  ref_type             text,
  ref_id               uuid,
  tabulation           text,
  protocol             text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_crm_event_lead ON crm_lead_event (lead_id, created_at);
ALTER TABLE crm_lead_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_lead_event_rls ON crm_lead_event;
CREATE POLICY crm_lead_event_rls ON crm_lead_event FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS crm_task (
  id                   uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id              uuid NOT NULL REFERENCES crm_lead(id) ON DELETE CASCADE,
  title                text NOT NULL,
  due_at               timestamptz,
  owner_membership_id  uuid,
  done_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_crm_task_owner ON crm_task (organization_id, owner_membership_id, due_at);
CREATE INDEX IF NOT EXISTS ix_crm_task_lead ON crm_task (lead_id);
ALTER TABLE crm_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_task FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_task_rls ON crm_task;
CREATE POLICY crm_task_rls ON crm_task FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
