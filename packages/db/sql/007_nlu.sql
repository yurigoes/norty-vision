-- ==============================================================================
-- 007_nlu.sql
-- NLU - Resolve o problema central das respostas frageis (1/2/3).
-- Tabela de palavras-chave configuravel por loja + log de mensagens
-- + fila de revisao humana.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- INTENT_KEYWORDS - palavras-chave que classificam mensagens
-- organization_id + store_id NULL = global da plataforma
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intent_keywords (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- escopo (NULL = global)
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE CASCADE,

  -- classificacao
  intent          text NOT NULL CHECK (intent IN (
    'confirm',
    'reschedule',
    'cancel',
    'question',
    'opt_out',
    'unknown'
  )),

  -- a palavra/frase (normalizada para lowercase + unaccent na busca)
  keyword         text NOT NULL,

  -- tipo de match
  match_type      text NOT NULL DEFAULT 'contains'
                  CHECK (match_type IN ('exact','contains','regex','starts_with')),

  -- peso na decisao (somado se varios baterem; vence a maior soma > threshold)
  weight          real NOT NULL DEFAULT 1.0 CHECK (weight > 0 AND weight <= 1),

  -- estado
  is_active       boolean NOT NULL DEFAULT true,

  -- origem da regra
  source          text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','seed','llm_suggestion','admin_promoted')),

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,

  -- nao duplica mesma keyword+intent no mesmo escopo
  UNIQUE NULLS NOT DISTINCT (organization_id, store_id, intent, keyword, match_type)
);

CREATE INDEX IF NOT EXISTS intent_keywords_lookup_idx
  ON intent_keywords (store_id, intent) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS intent_keywords_org_idx
  ON intent_keywords (organization_id, intent)
  WHERE is_active = true AND store_id IS NULL;
CREATE INDEX IF NOT EXISTS intent_keywords_global_idx
  ON intent_keywords (intent)
  WHERE is_active = true AND organization_id IS NULL AND store_id IS NULL;

DROP TRIGGER IF EXISTS tg_intent_keywords_updated_at ON intent_keywords;
CREATE TRIGGER tg_intent_keywords_updated_at
  BEFORE UPDATE ON intent_keywords
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE intent_keywords IS
  'Regras de classificacao por palavra-chave. Hierarquia: global -> organization -> store. Specific wins.';

-- ------------------------------------------------------------------------------
-- SEED de palavras-chave globais PT-BR
-- ------------------------------------------------------------------------------
INSERT INTO intent_keywords (intent, keyword, match_type, weight, source) VALUES
  -- CONFIRM
  ('confirm', '1',          'exact',    1.00, 'seed'),
  ('confirm', 'sim',        'exact',    1.00, 'seed'),
  ('confirm', 'confirmo',   'contains', 1.00, 'seed'),
  ('confirm', 'confirmado', 'contains', 1.00, 'seed'),
  ('confirm', 'confirma',   'contains', 0.95, 'seed'),
  ('confirm', 'pode vir',   'contains', 0.90, 'seed'),
  ('confirm', 'vou',        'exact',    0.85, 'seed'),
  ('confirm', 'estarei',    'contains', 0.85, 'seed'),
  ('confirm', 'beleza',     'exact',    0.80, 'seed'),
  ('confirm', 'ok',         'exact',    0.80, 'seed'),
  ('confirm', 'okay',       'exact',    0.80, 'seed'),
  ('confirm', 'ta bom',     'contains', 0.85, 'seed'),
  ('confirm', 'tá bom',     'contains', 0.85, 'seed'),
  ('confirm', 'tudo certo', 'contains', 0.85, 'seed'),
  ('confirm', 'positivo',   'contains', 0.85, 'seed'),
  ('confirm', 'aceito',     'contains', 0.85, 'seed'),
  ('confirm', '👍',         'contains', 0.85, 'seed'),
  ('confirm', '✅',         'contains', 0.95, 'seed'),

  -- RESCHEDULE
  ('reschedule', '2',                'exact',    1.00, 'seed'),
  ('reschedule', 'reagendar',        'contains', 1.00, 'seed'),
  ('reschedule', 'remarcar',         'contains', 1.00, 'seed'),
  ('reschedule', 'remarcacao',       'contains', 0.95, 'seed'),
  ('reschedule', 'outra data',       'contains', 0.90, 'seed'),
  ('reschedule', 'outro dia',        'contains', 0.90, 'seed'),
  ('reschedule', 'outro horario',    'contains', 0.90, 'seed'),
  ('reschedule', 'pode ser amanha',  'contains', 0.85, 'seed'),
  ('reschedule', 'mudar',            'contains', 0.75, 'seed'),
  ('reschedule', 'trocar',           'contains', 0.75, 'seed'),
  ('reschedule', 'nao posso vir',    'contains', 0.85, 'seed'),
  ('reschedule', 'não posso vir',    'contains', 0.85, 'seed'),

  -- CANCEL
  ('cancel', '3',           'exact',    1.00, 'seed'),
  ('cancel', 'cancelar',    'contains', 1.00, 'seed'),
  ('cancel', 'cancelo',     'contains', 1.00, 'seed'),
  ('cancel', 'cancela',     'contains', 0.95, 'seed'),
  ('cancel', 'desistir',    'contains', 0.90, 'seed'),
  ('cancel', 'nao vou',     'contains', 0.85, 'seed'),
  ('cancel', 'não vou',     'contains', 0.85, 'seed'),
  ('cancel', 'nao tenho mais interesse', 'contains', 0.90, 'seed'),
  ('cancel', 'não',         'exact',    0.70, 'seed'),
  ('cancel', 'nao',         'exact',    0.70, 'seed'),
  ('cancel', '❌',         'contains', 0.95, 'seed'),

  -- OPT-OUT (legal LGPD)
  ('opt_out', 'sair',           'exact',    0.90, 'seed'),
  ('opt_out', 'remover',        'contains', 0.85, 'seed'),
  ('opt_out', 'descadastrar',   'contains', 1.00, 'seed'),
  ('opt_out', 'descadastra',    'contains', 1.00, 'seed'),
  ('opt_out', 'pare',           'exact',    0.90, 'seed'),
  ('opt_out', 'parar',          'exact',    0.85, 'seed'),
  ('opt_out', 'nao me mande',   'contains', 0.90, 'seed'),
  ('opt_out', 'spam',           'contains', 0.85, 'seed'),
  ('opt_out', 'unsubscribe',    'contains', 1.00, 'seed'),
  ('opt_out', 'stop',           'exact',    0.95, 'seed')
ON CONFLICT (organization_id, store_id, intent, keyword, match_type) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MESSAGE_LOG - todas as mensagens enviadas E recebidas pelo sistema
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_log (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  -- direcao
  direction       text NOT NULL CHECK (direction IN ('outbound','inbound')),

  -- canal
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email','push','internal')),
  channel_message_id text,                                 -- id na Evolution/Twilio/etc

  -- partes
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  to_address      text,                                   -- numero/email destino
  from_address    text,

  -- conteudo
  template_code   text,                                   -- 'reminder_3d', 'confirmation_ok', etc
  body            text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,     -- dados estruturados (botoes, midia)

  -- relacoes (qualquer um pode ser null)
  appointment_id  uuid REFERENCES appointments(id) ON DELETE SET NULL,
  campaign_id     uuid,                                   -- FK adicionada em 009_campaigns
  campaign_target_id uuid,

  -- classificacao automatica (so para inbound)
  classified_intent text CHECK (classified_intent IN (
    'confirm','reschedule','cancel','question','opt_out','unknown'
  )),
  classified_score real,                                  -- 0..1 confianca
  classified_by   text CHECK (classified_by IN ('exact','keywords','llm','manual')),
  classified_at   timestamptz,

  -- estado de entrega (outbound)
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  failed_at       timestamptz,
  fail_reason     text,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_log_store_created_idx
  ON message_log (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_log_customer_idx
  ON message_log (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_log_appointment_idx
  ON message_log (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_log_status_idx
  ON message_log (store_id, status, created_at DESC) WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS message_log_intent_idx
  ON message_log (store_id, classified_intent, created_at DESC)
  WHERE direction = 'inbound' AND classified_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_log_channel_msg_idx
  ON message_log (channel, channel_message_id) WHERE channel_message_id IS NOT NULL;

COMMENT ON TABLE message_log IS
  'Log de TODAS as mensagens. Inbound = classificada via intent_keywords/LLM. Outbound = rastreamento de entrega.';

-- ------------------------------------------------------------------------------
-- UNRESOLVED_REPLIES - fila de respostas que o classificador nao decidiu
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unresolved_replies (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  message_id      uuid NOT NULL REFERENCES message_log(id) ON DELETE CASCADE,
  appointment_id  uuid REFERENCES appointments(id) ON DELETE SET NULL,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,

  -- conteudo bruto para revisao
  raw_text        text NOT NULL,

  -- candidatos rankeados pelo classificador (top 3)
  candidates      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- exemplo: [{"intent":"confirm","score":0.55},{"intent":"reschedule","score":0.4}]

  -- estado
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','resolved','dismissed','auto_learned')),

  -- resolucao manual
  resolved_intent text CHECK (resolved_intent IN (
    'confirm','reschedule','cancel','question','opt_out','unknown'
  )),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_note text,

  -- se o resolutor escolheu "promover esta palavra como keyword nova"
  promoted_to_keyword_id uuid REFERENCES intent_keywords(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unresolved_replies_queue_idx
  ON unresolved_replies (store_id, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS unresolved_replies_resolved_idx
  ON unresolved_replies (resolved_by, resolved_at DESC)
  WHERE status = 'resolved';

DROP TRIGGER IF EXISTS tg_unresolved_replies_updated_at ON unresolved_replies;
CREATE TRIGGER tg_unresolved_replies_updated_at
  BEFORE UPDATE ON unresolved_replies
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE unresolved_replies IS
  'Fila pra recepcao classificar manualmente mensagens que o sistema nao entendeu. Resolucao opcional promove a palavra como nova intent_keyword.';
