-- ==============================================================================
-- 087_inbox.sql  (idempotente)
--
-- Atendimento omnichannel (substitui o Chatwoot). Multi-tenant com RLS org-scoped.
-- Reusa helpdesk_teams (equipes) e o padrão de SLA.
--
-- Tabelas:
--   inboxes              — caixas de entrada (whatsapp/email/webchat) por org
--   inbox_agents         — agentes (memberships) por inbox
--   conversations        — conversas
--   conversation_messages— mensagens (in/out, agente/contato/bot/sistema)
--   conversation_labels / conversation_label_links — etiquetas
--   canned_responses     — respostas rápidas
--   bot_flows            — fluxos de triagem (passos em JSON)
--   bot_sessions         — estado do bot por conversa
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- inboxes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inboxes (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email','webchat')),
  -- whatsapp: instância Evolution; email: caixa; webchat: token público do widget
  channel_ref     text,                  -- ex.: instância Evolution / endereço de e-mail
  team_id         uuid REFERENCES helpdesk_teams(id) ON DELETE SET NULL,
  sla_policy_id   uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
  bot_enabled     boolean NOT NULL DEFAULT false,
  auto_reply      text,                  -- mensagem automática (fora de horário/saudação)
  greeting        text,
  config          jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inboxes_org_idx ON inboxes (organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS inboxes_channel_ref_idx ON inboxes (organization_id, channel, channel_ref);
DROP TRIGGER IF EXISTS tg_inboxes_updated_at ON inboxes;
CREATE TRIGGER tg_inboxes_updated_at BEFORE UPDATE ON inboxes
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inboxes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inboxes_rls ON inboxes;
CREATE POLICY inboxes_rls ON inboxes FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- inbox_agents
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_agents (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbox_id        uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbox_id, membership_id)
);
CREATE INDEX IF NOT EXISTS inbox_agents_org_idx ON inbox_agents (organization_id);
ALTER TABLE inbox_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_agents_rls ON inbox_agents;
CREATE POLICY inbox_agents_rls ON inbox_agents FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- conversations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbox_id            uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  channel             text NOT NULL,
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  contact_name        text,
  contact_phone       text,                -- whatsapp (só dígitos)
  contact_email       text,
  external_id         text,                -- chave do canal (jid whatsapp / msg-id / sessão webchat)
  subject             text,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','pending','snoozed','resolved')),
  priority            text NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  assignee_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  team_id             uuid REFERENCES helpdesk_teams(id) ON DELETE SET NULL,
  bot_active          boolean NOT NULL DEFAULT false,  -- bot de triagem está conduzindo
  sla_policy_id       uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  snoozed_until       timestamptz,
  last_message_at     timestamptz,
  last_inbound_at     timestamptz,
  unread_agent        int NOT NULL DEFAULT 0,           -- não lidas pelo agente
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_inbox_status_idx ON conversations (inbox_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_org_idx ON conversations (organization_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_external_idx ON conversations (inbox_id, external_id);
CREATE INDEX IF NOT EXISTS conversations_assignee_idx ON conversations (assignee_membership_id) WHERE status != 'resolved';
DROP TRIGGER IF EXISTS tg_conversations_updated_at ON conversations;
CREATE TRIGGER tg_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_rls ON conversations;
CREATE POLICY conversations_rls ON conversations FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- conversation_messages
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_messages (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  author_type         text NOT NULL DEFAULT 'agent'
                      CHECK (author_type IN ('contact','agent','bot','system')),
  author_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  author_name         text,
  content             text,
  content_type        text NOT NULL DEFAULT 'text'
                      CHECK (content_type IN ('text','image','file','audio','video','template','event')),
  media_url           text,
  media_mime          text,
  external_id         text,                -- id da mensagem no canal (dedup)
  status              text NOT NULL DEFAULT 'sent'
                      CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  is_private          boolean NOT NULL DEFAULT false,  -- nota interna
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conv_messages_conv_idx ON conversation_messages (conversation_id, created_at);
-- dedup de inbound por canal (evita processar a mesma msg 2x)
CREATE UNIQUE INDEX IF NOT EXISTS conv_messages_external_uq
  ON conversation_messages (conversation_id, external_id) WHERE external_id IS NOT NULL;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_messages_rls ON conversation_messages;
CREATE POLICY conversation_messages_rls ON conversation_messages FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- labels
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_labels (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
ALTER TABLE conversation_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_labels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_labels_rls ON conversation_labels;
CREATE POLICY conversation_labels_rls ON conversation_labels FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS conversation_label_links (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id        uuid NOT NULL REFERENCES conversation_labels(id) ON DELETE CASCADE,
  UNIQUE (conversation_id, label_id)
);
CREATE INDEX IF NOT EXISTS conv_label_links_org_idx ON conversation_label_links (organization_id);
ALTER TABLE conversation_label_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_label_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_label_links_rls ON conversation_label_links;
CREATE POLICY conv_label_links_rls ON conversation_label_links FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- canned_responses (respostas rápidas)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canned_responses (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortcut        text NOT NULL,
  title           text,
  body            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shortcut)
);
CREATE INDEX IF NOT EXISTS canned_responses_org_idx ON canned_responses (organization_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_canned_responses_updated_at ON canned_responses;
CREATE TRIGGER tg_canned_responses_updated_at BEFORE UPDATE ON canned_responses
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canned_responses_rls ON canned_responses;
CREATE POLICY canned_responses_rls ON canned_responses FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- bot_flows (triagem) + bot_sessions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_flows (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbox_id        uuid REFERENCES inboxes(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  -- steps: array de passos {id, type:'message'|'ask'|'menu'|'action'|'handoff', text, options[], next, action}
  steps           jsonb NOT NULL DEFAULT '[]',
  -- frase fora de horário comercial
  offhours_text   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_flows_org_idx ON bot_flows (organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS bot_flows_inbox_idx ON bot_flows (inbox_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_bot_flows_updated_at ON bot_flows;
CREATE TRIGGER tg_bot_flows_updated_at BEFORE UPDATE ON bot_flows
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE bot_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_flows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_flows_rls ON bot_flows;
CREATE POLICY bot_flows_rls ON bot_flows FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS bot_sessions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  flow_id         uuid REFERENCES bot_flows(id) ON DELETE SET NULL,
  current_step    text,
  data            jsonb NOT NULL DEFAULT '{}',   -- respostas coletadas
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','handoff','abandoned')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);
CREATE INDEX IF NOT EXISTS bot_sessions_org_idx ON bot_sessions (organization_id);
DROP TRIGGER IF EXISTS tg_bot_sessions_updated_at ON bot_sessions;
CREATE TRIGGER tg_bot_sessions_updated_at BEFORE UPDATE ON bot_sessions
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_sessions_rls ON bot_sessions;
CREATE POLICY bot_sessions_rls ON bot_sessions FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
