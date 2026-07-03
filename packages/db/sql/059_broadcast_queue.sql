-- ==============================================================================
-- 059_broadcast_queue.sql
-- Fila de mala direta: cada destinatário vira uma mensagem agendada (scheduled_at
-- escalonado) e um worker (cron na API) envia no ritmo seguro, evitando ban do
-- WhatsApp. Sobrevive a restart (estado no banco).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','email')),
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  to_address      text NOT NULL,                 -- telefone (E.164) ou email
  subject         text,
  body            text NOT NULL,                 -- já renderizado por destinatário
  image_url       text,
  category        text,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','canceled')),
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  error           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- worker busca por status+canal+horário
CREATE INDEX IF NOT EXISTS broadcast_messages_due_idx
  ON broadcast_messages (channel, status, scheduled_at);
CREATE INDEX IF NOT EXISTS broadcast_messages_org_idx
  ON broadcast_messages (organization_id, created_at DESC);

ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broadcast_messages_rls ON broadcast_messages;
CREATE POLICY broadcast_messages_rls ON broadcast_messages FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
