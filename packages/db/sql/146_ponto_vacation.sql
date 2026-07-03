-- ==============================================================================
-- 146_ponto_vacation.sql  (idempotente)  —  RH/PONTO: Férias
--
-- Controle de férias por funcionário. O saldo é derivado do período aquisitivo
-- (a cada 12 meses de admissão = 30 dias de direito) menos os dias agendados/
-- gozados (status != cancelado). Recibo de férias em PDF pelo painel.
-- Org-scoped (RLS por organização).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_vacation (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  start_date      date NOT NULL,
  days            integer NOT NULL DEFAULT 30,
  status          text NOT NULL DEFAULT 'scheduled',   -- scheduled | taken | canceled
  thirteenth_advance boolean NOT NULL DEFAULT false,    -- abono/adiantamento 13º junto
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ponto_vacation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_vacation_rls ON ponto_vacation;
CREATE POLICY ponto_vacation_rls ON ponto_vacation
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_ponto_vacation_emp ON ponto_vacation (organization_id, employee_id, start_date);
