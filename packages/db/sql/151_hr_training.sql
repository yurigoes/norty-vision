-- ==============================================================================
-- 151_hr_training.sql  (idempotente)  —  RH: Treinamentos / certificações
--
-- Treinamentos e certificações por funcionário (NR-10, NR-35, brigada, etc.),
-- com data de realização, validade (vencimento) e certificado anexado.
-- Org-scoped (RLS por organização). Mesmo padrão do ASO.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS employee_training (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name            text NOT NULL,                          -- ex.: NR-35 Trabalho em Altura
  provider        text,                                   -- instrutor/empresa
  completed_date  date,
  due_date        date,                                   -- validade
  hours           integer,                                -- carga horária
  file_url        text,                                   -- certificado (bucket)
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_training ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_training_rls ON employee_training;
CREATE POLICY employee_training_rls ON employee_training
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_employee_training ON employee_training (organization_id, employee_id, due_date);
