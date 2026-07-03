-- ==============================================================================
-- 148_ponto_alerts.sql  (idempotente)  —  PONTO: Alertas automáticos
--
-- Config de alertas no empregador + log de dedupe (1 alerta por funcionário/dia/tipo).
--   • avisa funcionário: não registrou entrada / esqueceu a saída
--   • resumo diário de divergências para o gestor (WhatsApp/e-mail)
--   • alerta semanal de hora extra acima do limite
-- ==============================================================================

ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS alert_whatsapp text;          -- contato do gestor (resumo)
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS alert_email text;
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS alert_summary_hour integer NOT NULL DEFAULT 20;   -- hora local do resumo diário
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS overtime_weekly_alert_min integer NOT NULL DEFAULT 600; -- 10h
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS alert_summary_last date;      -- throttle do resumo (1x/dia)

-- log de alertas enviados (dedupe por funcionário/dia/tipo)
CREATE TABLE IF NOT EXISTS ponto_alert_log (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  day             date NOT NULL,
  kind            text NOT NULL,                          -- miss_in | miss_out | overtime
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_id, day, kind)
);
ALTER TABLE ponto_alert_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_alert_log_rls ON ponto_alert_log;
CREATE POLICY ponto_alert_log_rls ON ponto_alert_log
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_ponto_alert_log ON ponto_alert_log (organization_id, day);
