-- ==============================================================================
-- 183_inbox_webhooks.sql  (idempotente)
--
-- Webhooks out: a empresa configura uma URL externa (n8n, Zapier, etc) e o
-- yugo dispara POST com payload JSON quando eventos do inbox acontecem.
--
-- Eventos suportados (subscribe via events array):
--   conversation.created       — nova conversa
--   message.created            — mensagem (in ou out)
--   conversation.assigned      — operador atribuído
--   conversation.resolved      — conversa finalizada
--   csat.responded             — pesquisa de satisfação respondida
--
-- A entrega é best-effort. Falhas são contadas em deliver_fail_count; após
-- 5 falhas seguidas o webhook é desativado automaticamente (is_active=false).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inbox_webhooks (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL,
  url                text NOT NULL,
  -- segredo opcional pra assinatura HMAC-SHA256 (header X-Yugo-Signature)
  secret             text,
  -- array de event names que disparam o POST
  events             text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active          boolean NOT NULL DEFAULT true,
  last_delivered_at  timestamptz,
  deliver_fail_count int NOT NULL DEFAULT 0,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_webhooks_org_idx ON inbox_webhooks (organization_id, is_active);

ALTER TABLE inbox_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_webhooks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_webhooks_tenant ON inbox_webhooks;
CREATE POLICY inbox_webhooks_tenant ON inbox_webhooks
  FOR ALL
  USING (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  )
  WITH CHECK (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  );
