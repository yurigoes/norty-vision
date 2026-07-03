-- ==============================================================================
-- 147_hr_exam_warning.sql  (idempotente)  —  RH: Exames ocupacionais (ASO) + Advertências
--
-- ASO/exames: admissional, periódico, demissional, retorno ao trabalho, mudança
-- de função — com data de realização, vencimento (próximo periódico) e resultado.
-- Advertências/ocorrências disciplinares com ciência (assinatura) do funcionário.
-- Org-scoped (RLS por organização).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS employee_exam (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'periodico',     -- admissional|periodico|demissional|retorno|mudanca_funcao
  exam_date       date,
  due_date        date,                                  -- vencimento (próximo exame)
  result          text,                                  -- apto|inapto|apto_com_restricao
  doctor          text,                                  -- médico/clínica (PCMSO)
  file_url        text,                                  -- ASO digitalizado (bucket)
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_exam ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_exam_rls ON employee_exam;
CREATE POLICY employee_exam_rls ON employee_exam
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_employee_exam ON employee_exam (organization_id, employee_id, due_date);

CREATE TABLE IF NOT EXISTS employee_warning (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'advertencia_escrita', -- advertencia_verbal|advertencia_escrita|suspensao
  date            date NOT NULL,
  reason          text NOT NULL,
  suspension_days integer,                               -- dias (quando suspensão)
  file_url        text,                                  -- documento assinado/anexo
  acknowledged_at timestamptz,                           -- ciência do funcionário (portal)
  ack_signature_url text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_warning ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_warning_rls ON employee_warning;
CREATE POLICY employee_warning_rls ON employee_warning
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_employee_warning ON employee_warning (organization_id, employee_id, date);
