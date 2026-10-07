-- 204_ponto_leave_novo.sql
-- Portado de yugo-ponto (204_ponto_leave.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 204_ponto_leave.sql  (idempotente)  —  Afastamentos (CLT/Previdência)
--
-- Período em que o funcionário está afastado (INSS/doença, acidente, maternidade,
-- paternidade, serviço militar, licença não remunerada). No espelho, os dias do
-- afastamento NÃO contam como falta nem como previsto (não inflam o absenteísmo).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_leave (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  type            text NOT NULL,                 -- inss_doenca | acidente | maternidade | paternidade | servico_militar | licenca_nr | outro
  start_date      date NOT NULL,
  end_date        date,                           -- nulo = em aberto
  reason          text,
  doc_key         text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ponto_leave_emp ON ponto_leave (organization_id, employee_id, start_date);

ALTER TABLE ponto_leave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_leave_rls ON ponto_leave;
CREATE POLICY ponto_leave_rls ON ponto_leave
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
