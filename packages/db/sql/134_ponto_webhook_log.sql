-- ==============================================================================
-- 134_ponto_webhook_log.sql  (idempotente)  —  PONTO: inbox interno de eventos
--
-- Todo evento (ex.: ponto.punch.created) é GRAVADO no sistema (feed por empresa),
-- além de, opcionalmente, ser enviado a uma URL externa. Assim cada empresa já
-- tem os eventos prontos pra consultar/integrar, sem precisar de servidor externo.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_webhook_event (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  target_url      text,                 -- URL externa, se houver
  delivered       boolean NOT NULL DEFAULT false,
  status_code     integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_webhook_event_org_idx ON ponto_webhook_event(organization_id, created_at DESC);

ALTER TABLE ponto_webhook_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_webhook_event_rls ON ponto_webhook_event;
CREATE POLICY ponto_webhook_event_rls ON ponto_webhook_event
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
