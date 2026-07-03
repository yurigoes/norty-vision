-- ==============================================================================
-- 008_leads.sql
-- CRM basico: leads, pipelines (kanban configuravel), stages, events.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- LEAD_PIPELINES - cada loja pode ter varios pipelines (vendas, atendimento)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_pipelines (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  slug            citext NOT NULL,
  name            text   NOT NULL,
  description     text,

  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,

  display_order   int NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (store_id, slug)
);

DROP TRIGGER IF EXISTS tg_lead_pipelines_updated_at ON lead_pipelines;
CREATE TRIGGER tg_lead_pipelines_updated_at
  BEFORE UPDATE ON lead_pipelines
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- LEAD_STAGES - colunas do kanban (configuravel por pipeline)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_stages (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  pipeline_id     uuid NOT NULL REFERENCES lead_pipelines(id) ON DELETE CASCADE,

  slug            citext NOT NULL,
  name            text   NOT NULL,                        -- "Novo", "Contato feito", "Proposta", "Convertido"
  description     text,

  -- estatistica/visual
  color_hex       text CHECK (color_hex ~ '^#[0-9a-fA-F]{6}$'),
  display_order   int NOT NULL DEFAULT 0,

  -- semantica
  stage_type      text NOT NULL DEFAULT 'open'
                  CHECK (stage_type IN ('open','won','lost','archived')),

  -- automacoes
  auto_archive_after_days int,                            -- se passou tantos dias sem mexer, arquiva
  default_followup_days   int,                            -- recomendar followup em N dias

  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (pipeline_id, slug)
);

CREATE INDEX IF NOT EXISTS lead_stages_pipeline_order_idx
  ON lead_stages (pipeline_id, display_order) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_lead_stages_updated_at ON lead_stages;
CREATE TRIGGER tg_lead_stages_updated_at
  BEFORE UPDATE ON lead_stages
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- LEADS - oportunidade comercial
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  pipeline_id     uuid NOT NULL REFERENCES lead_pipelines(id) ON DELETE RESTRICT,
  stage_id        uuid NOT NULL REFERENCES lead_stages(id) ON DELETE RESTRICT,

  -- pessoa
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  name            text NOT NULL,                          -- copia se customer_id existir
  phone           text,
  email           citext,

  -- comercial
  title           text,                                   -- "Interesse em oculos progressivo"
  description     text,
  estimated_value_cents bigint,                           -- valor estimado em centavos
  source          text,                                   -- 'website','indicacao','disparo','manual','import'
  source_detail   text,                                   -- detalhes da origem
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,

  -- atribuicao
  assigned_to     uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at     timestamptz,

  -- tags livres
  tags            text[] NOT NULL DEFAULT '{}',

  -- ciclo
  first_touch_at  timestamptz,
  last_touch_at   timestamptz,
  next_followup_at timestamptz,

  -- fechamento
  closed_at       timestamptz,
  closed_value_cents bigint,                              -- valor real fechado
  lost_reason     text,

  -- metadata
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS leads_store_stage_idx
  ON leads (store_id, stage_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_assigned_idx
  ON leads (assigned_to, stage_id) WHERE deleted_at IS NULL AND assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_customer_idx
  ON leads (customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_followup_idx
  ON leads (store_id, next_followup_at)
  WHERE next_followup_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_phone_idx
  ON leads (store_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_name_trgm
  ON leads USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_tags_idx
  ON leads USING gin (tags) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_leads_updated_at ON leads;
CREATE TRIGGER tg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE leads IS
  'Oportunidade comercial. customer_id opcional (pode virar customer no fechamento).';

-- ------------------------------------------------------------------------------
-- LEAD_EVENTS - timeline imutavel
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  event_type      text NOT NULL CHECK (event_type IN (
    'created',
    'stage_changed',
    'assigned',
    'unassigned',
    'note_added',
    'message_sent',
    'message_received',
    'call_logged',
    'meeting_scheduled',
    'won',
    'lost',
    'reopened',
    'archived'
  )),

  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  actor_type      text CHECK (actor_type IN ('system','staff','customer','platform','automation')),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label     text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_events_lead_idx
  ON lead_events (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_events_store_idx
  ON lead_events (store_id, created_at DESC);

COMMENT ON TABLE lead_events IS
  'Timeline imutavel por lead. Append-only.';
