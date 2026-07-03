-- ==============================================================================
-- 009_campaigns.sql
-- Disparador: templates, campanhas, alvos e mensagens.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- CAMPAIGN_TEMPLATES - templates de mensagem reutilizaveis
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_templates (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid REFERENCES stores(id) ON DELETE RESTRICT,
  -- store_id NULL = template da org (disponivel pra todas as lojas)

  slug            citext NOT NULL,
  name            text   NOT NULL,
  description     text,

  -- conteudo
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  body            text NOT NULL,                          -- usa {{customer.name}} etc

  -- whatsapp business template (se aplicavel)
  whatsapp_template_name text,
  whatsapp_template_language text,                        -- 'pt_BR'

  -- midia opcional
  media_url       text,
  media_type      text CHECK (media_type IN ('image','video','document','audio')),

  -- variaveis declaradas (validacao)
  variables       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- exemplo: [{"name":"customer.name","required":true},{"name":"appointment.date","required":true}]

  -- aprovacao (canais que exigem como WhatsApp Business)
  approval_status text NOT NULL DEFAULT 'draft'
                  CHECK (approval_status IN ('draft','pending','approved','rejected','disabled')),
  approval_metadata jsonb,

  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE NULLS NOT DISTINCT (organization_id, store_id, slug)
);

CREATE INDEX IF NOT EXISTS campaign_templates_lookup_idx
  ON campaign_templates (organization_id, store_id, channel)
  WHERE is_active = true AND approval_status = 'approved';

DROP TRIGGER IF EXISTS tg_campaign_templates_updated_at ON campaign_templates;
CREATE TRIGGER tg_campaign_templates_updated_at
  BEFORE UPDATE ON campaign_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- CAMPAIGNS - disparo em massa
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  name            text NOT NULL,
  description     text,

  template_id     uuid NOT NULL REFERENCES campaign_templates(id) ON DELETE RESTRICT,

  -- segmentacao (filtros pra montar a lista no momento do disparo)
  segment         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- exemplo:
  -- {
  --   "tags_any": ["interessado-progressivo"],
  --   "last_purchase_before": "2025-01-01",
  --   "opt_out_marketing": false
  -- }

  -- canal (deve bater com o do template)
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),

  -- agendamento
  scheduled_for   timestamptz,                            -- null = enviar ja
  rate_per_minute int NOT NULL DEFAULT 30 CHECK (rate_per_minute > 0),

  -- estado
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','running','paused','completed','failed','canceled')),

  -- contadores (mantidos por trigger ou pelo worker)
  total_targets   int NOT NULL DEFAULT 0,
  sent_count      int NOT NULL DEFAULT 0,
  delivered_count int NOT NULL DEFAULT 0,
  read_count      int NOT NULL DEFAULT 0,
  replied_count   int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  opted_out_count int NOT NULL DEFAULT 0,

  -- execucao
  started_at      timestamptz,
  completed_at    timestamptz,
  paused_at       timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS campaigns_store_status_idx
  ON campaigns (store_id, status, scheduled_for);

DROP TRIGGER IF EXISTS tg_campaigns_updated_at ON campaigns;
CREATE TRIGGER tg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- CAMPAIGN_TARGETS - alvos da campanha (snapshot do segmento no inicio)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_targets (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  -- destinatario (customer e a fonte normal; opcional pra envios manuais)
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  to_address      text NOT NULL,                          -- numero/email final usado
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- valores substituidos

  -- estado de envio
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sending','sent','delivered','read','replied','failed','skipped','opted_out')),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  replied_at      timestamptz,
  failed_at       timestamptz,
  fail_reason     text,
  attempts        int NOT NULL DEFAULT 0,

  -- ligacao com mensagem enviada
  message_id      uuid REFERENCES message_log(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_targets_queue_idx
  ON campaign_targets (campaign_id, status, created_at)
  WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS campaign_targets_customer_idx
  ON campaign_targets (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS tg_campaign_targets_updated_at ON campaign_targets;
CREATE TRIGGER tg_campaign_targets_updated_at
  BEFORE UPDATE ON campaign_targets
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- FK tardia em message_log para campaigns/targets
-- (referenciado em 007_nlu mas a tabela soh existe agora)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'message_log_campaign_fk'
  ) THEN
    ALTER TABLE message_log
      ADD CONSTRAINT message_log_campaign_fk
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'message_log_campaign_target_fk'
  ) THEN
    ALTER TABLE message_log
      ADD CONSTRAINT message_log_campaign_target_fk
      FOREIGN KEY (campaign_target_id) REFERENCES campaign_targets(id) ON DELETE SET NULL;
  END IF;
END
$$;
