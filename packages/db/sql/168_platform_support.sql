-- ==============================================================================
-- 168_platform_support.sql  (idempotente)  —  SUPORTE AO SISTEMA (empresa → master)
-- Canal de chamados que a empresa abre PRO MASTER (dono do SaaS). Cross-tenant:
-- o master vê de todas as empresas. Operador vê só os dele; admin vê os da empresa.
-- Inclui atendimento por IA (primeiro nível) e fluxos seguros (senha/e-mail/tel).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS platform_support_ticket (
  id                      uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id                uuid,
  requester_user_id       uuid,
  requester_membership_id uuid,
  requester_name          text,
  requester_role          text,                          -- snapshot: owner/admin/manager/operador
  category                text NOT NULL DEFAULT 'duvida' -- duvida|bug|solicitacao|senha|email|telefone|outro
                          CHECK (category IN ('duvida','bug','solicitacao','senha','email','telefone','outro')),
  subject                 text NOT NULL,
  priority                text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status                  text NOT NULL DEFAULT 'aberto'
                          CHECK (status IN ('aberto','aguardando_master','aguardando_usuario','resolvido_ia','resolvido','fechado')),
  channel                 text NOT NULL DEFAULT 'portal' CHECK (channel IN ('portal','ia')),
  ai_handled              boolean NOT NULL DEFAULT false,
  ai_summary              text,
  resolution              text,
  resolved_by_master      uuid,
  resolved_at             timestamptz,
  short_code              text UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_psup_ticket_org ON platform_support_ticket (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_psup_ticket_requester ON platform_support_ticket (requester_user_id);
CREATE INDEX IF NOT EXISTS ix_psup_ticket_status ON platform_support_ticket (status, created_at DESC);
ALTER TABLE platform_support_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_support_ticket FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_support_ticket_rls ON platform_support_ticket;
CREATE POLICY platform_support_ticket_rls ON platform_support_ticket FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS platform_support_message (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id       uuid NOT NULL REFERENCES platform_support_ticket(id) ON DELETE CASCADE,
  author          text NOT NULL CHECK (author IN ('usuario','ia','master','sistema')),
  author_user_id  uuid,
  body            text NOT NULL,
  internal        boolean NOT NULL DEFAULT false,   -- nota interna do master (usuário não vê)
  redacted        boolean NOT NULL DEFAULT false,   -- continha segredo, mascarado ao fechar
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_psup_msg_ticket ON platform_support_message (ticket_id, created_at);
ALTER TABLE platform_support_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_support_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_support_message_rls ON platform_support_message;
CREATE POLICY platform_support_message_rls ON platform_support_message FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
