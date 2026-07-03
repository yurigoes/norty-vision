-- ==============================================================================
-- 085_helpdesk.sql  (idempotente)
--
-- Modulo de Chamados + Ordens de Servico (substitui o GLPI). Multi-tenant com RLS
-- org-scoped (acesso do cliente final via service layer, igual portal/crediario).
--
-- Tabelas:
--   helpdesk_teams / helpdesk_team_members  — filas/equipes
--   ticket_categories                       — categorias (com equipe/SLA padrao)
--   sla_policies                            — prazos de 1a resposta e resolucao
--   business_hours                          — horario comercial p/ calculo de SLA
--   tickets                                 — chamados
--   ticket_messages                         — respostas (publicas) e notas internas
--   ticket_attachments                      — anexos (MinIO)
--   ticket_events                           — timeline/auditoria
--   service_orders / service_order_items / service_order_events  — OS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- helpdesk_teams + membros
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS helpdesk_teams (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpdesk_teams_org_idx ON helpdesk_teams (organization_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_helpdesk_teams_updated_at ON helpdesk_teams;
CREATE TRIGGER tg_helpdesk_teams_updated_at BEFORE UPDATE ON helpdesk_teams
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE helpdesk_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS helpdesk_teams_rls ON helpdesk_teams;
CREATE POLICY helpdesk_teams_rls ON helpdesk_teams FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS helpdesk_team_members (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES helpdesk_teams(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, membership_id)
);
CREATE INDEX IF NOT EXISTS helpdesk_team_members_org_idx ON helpdesk_team_members (organization_id);
ALTER TABLE helpdesk_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_team_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS helpdesk_team_members_rls ON helpdesk_team_members;
CREATE POLICY helpdesk_team_members_rls ON helpdesk_team_members FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- sla_policies
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_policies (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  priority            text NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  first_response_mins int NOT NULL DEFAULT 240,   -- prazo 1a resposta (min)
  resolution_mins     int NOT NULL DEFAULT 1440,  -- prazo de resolucao (min)
  use_business_hours  boolean NOT NULL DEFAULT true,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sla_policies_org_idx ON sla_policies (organization_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_sla_policies_updated_at ON sla_policies;
CREATE TRIGGER tg_sla_policies_updated_at BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sla_policies_rls ON sla_policies;
CREATE POLICY sla_policies_rls ON sla_policies FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- business_hours (1 linha por dia da semana, por org)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_hours (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  weekday         int NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=domingo
  is_open         boolean NOT NULL DEFAULT true,
  open_time       text NOT NULL DEFAULT '08:00',
  close_time      text NOT NULL DEFAULT '18:00',
  UNIQUE (organization_id, weekday)
);
CREATE INDEX IF NOT EXISTS business_hours_org_idx ON business_hours (organization_id);
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_hours_rls ON business_hours;
CREATE POLICY business_hours_rls ON business_hours FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- ticket_categories
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_categories (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  color            text,
  default_team_id  uuid REFERENCES helpdesk_teams(id) ON DELETE SET NULL,
  default_sla_id   uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
  display_order    int NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_categories_org_idx ON ticket_categories (organization_id) WHERE is_active;
DROP TRIGGER IF EXISTS tg_ticket_categories_updated_at ON ticket_categories;
CREATE TRIGGER tg_ticket_categories_updated_at BEFORE UPDATE ON ticket_categories
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE ticket_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_categories_rls ON ticket_categories;
CREATE POLICY ticket_categories_rls ON ticket_categories FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- tickets
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                    uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id              uuid REFERENCES stores(id) ON DELETE SET NULL,
  code                  text NOT NULL,                 -- codigo curto publico (ex.: CH-7K3P9Q)

  -- solicitante: cliente final (portal) OU usuario interno OU contato avulso
  requester_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  requester_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  requester_name        text,
  requester_email       text,
  requester_phone       text,

  channel               text NOT NULL DEFAULT 'manual'
                        CHECK (channel IN ('portal','email','whatsapp','webchat','manual')),
  category_id           uuid REFERENCES ticket_categories(id) ON DELETE SET NULL,
  team_id               uuid REFERENCES helpdesk_teams(id) ON DELETE SET NULL,
  assignee_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,

  subject               text NOT NULL,
  priority              text NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),
  status                text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','triage','open','pending','waiting_customer','resolved','closed','reopened')),

  sla_policy_id         uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
  first_response_due_at timestamptz,
  resolution_due_at     timestamptz,
  first_response_at     timestamptz,
  resolved_at           timestamptz,
  closed_at             timestamptz,
  sla_breached          boolean NOT NULL DEFAULT false,
  escalated_at          timestamptz,

  reopened_count        int NOT NULL DEFAULT 0,
  satisfaction_rating   int CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment  text,

  -- tokenizacao em 2 niveis (link publico): nivel 1 acompanha, nivel 2 age
  public_token          text,
  action_token          text,

  created_by_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS tickets_org_status_idx ON tickets (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_assignee_idx   ON tickets (assignee_membership_id) WHERE status NOT IN ('closed','resolved');
CREATE INDEX IF NOT EXISTS tickets_customer_idx   ON tickets (requester_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_public_token_idx ON tickets (public_token);
DROP TRIGGER IF EXISTS tg_tickets_updated_at ON tickets;
CREATE TRIGGER tg_tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tickets_rls ON tickets;
CREATE POLICY tickets_rls ON tickets FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- ticket_messages (respostas publicas + notas internas + bot/sistema)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id           uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type         text NOT NULL DEFAULT 'agent'
                      CHECK (author_type IN ('customer','agent','system','bot')),
  author_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  author_name         text,
  body                text NOT NULL,
  is_internal         boolean NOT NULL DEFAULT false,   -- nota interna (cliente nao ve)
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_messages_rls ON ticket_messages;
CREATE POLICY ticket_messages_rls ON ticket_messages FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- ticket_attachments (MinIO)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id       uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES ticket_messages(id) ON DELETE CASCADE,
  file_url        text NOT NULL,
  file_name       text,
  content_type    text,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx ON ticket_attachments (ticket_id);
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_attachments_rls ON ticket_attachments;
CREATE POLICY ticket_attachments_rls ON ticket_attachments FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- ticket_events (timeline/auditoria)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_events (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id       uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type      text NOT NULL,            -- created|assigned|status|reply|sla_breach|reopened|closed...
  payload         jsonb,
  actor_type      text NOT NULL DEFAULT 'system'
                  CHECK (actor_type IN ('customer','agent','system','bot')),
  actor_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, created_at);
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_events_rls ON ticket_events;
CREATE POLICY ticket_events_rls ON ticket_events FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- service_orders (OS) — pode estar ligada a um ticket
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_orders (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id            uuid REFERENCES stores(id) ON DELETE SET NULL,
  ticket_id           uuid REFERENCES tickets(id) ON DELETE SET NULL,
  code                text NOT NULL,
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  type                text NOT NULL DEFAULT 'repair'
                      CHECK (type IN ('repair','warranty','assistance','other')),
  title               text NOT NULL,
  description         text,
  equipment           text,                 -- ex.: armacao/modelo/lente
  technician_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','waiting_part','ready','delivered','canceled')),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  due_at              timestamptz,
  ready_at            timestamptz,
  delivered_at        timestamptz,
  total_cents         bigint NOT NULL DEFAULT 0,
  approval_status     text NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN ('pending','approved','rejected','not_required')),
  approved_at         timestamptz,
  approval_token      text,                 -- token nivel 2 p/ cliente aprovar
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS service_orders_org_status_idx ON service_orders (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_orders_customer_idx   ON service_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_orders_ticket_idx     ON service_orders (ticket_id);
DROP TRIGGER IF EXISTS tg_service_orders_updated_at ON service_orders;
CREATE TRIGGER tg_service_orders_updated_at BEFORE UPDATE ON service_orders
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_orders_rls ON service_orders;
CREATE POLICY service_orders_rls ON service_orders FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS service_order_items (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'service' CHECK (kind IN ('part','service')),
  description     text NOT NULL,
  qty             numeric(10,2) NOT NULL DEFAULT 1,
  unit_cents      bigint NOT NULL DEFAULT 0,
  total_cents     bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_order_items_so_idx ON service_order_items (service_order_id);
ALTER TABLE service_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_order_items_rls ON service_order_items;
CREATE POLICY service_order_items_rls ON service_order_items FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS service_order_events (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb,
  actor_type      text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('customer','agent','system','bot')),
  actor_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_order_events_so_idx ON service_order_events (service_order_id, created_at);
ALTER TABLE service_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_order_events_rls ON service_order_events;
CREATE POLICY service_order_events_rls ON service_order_events FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
