-- ==============================================================================
-- 075_hr_attendance.sql
-- Ponto: faltas, justificativas e atestados.
--   attendance_justifications: o funcionário justifica um dia —
--     'forgot_punch' (esqueceu de bater → propõe os horários, pendente de aprovação)
--     'medical'      (atestado → upload + qtd de dias + código gerado na aprovação)
--   attendance_marks: marcação resolvida por dia (ex.: atestado aprovado),
--     usada pelo espelho de ponto.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS attendance_justifications (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_date         date NOT NULL,                 -- dia da falta/ajuste (medical: data inicial)
  kind             text NOT NULL CHECK (kind IN ('forgot_punch','medical','other')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  proposed         jsonb,                          -- forgot_punch: {"in":"08:00","out":"17:00","break_in":"12:00","break_out":"13:00"}
  attachment_url   text,                           -- atestado (arquivo)
  days_count       int NOT NULL DEFAULT 1,
  end_date         date,                           -- medical: ref_date + days_count - 1
  internal_code    text,                           -- gerado na aprovação do atestado
  note             text,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  review_note      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_justifications_emp_idx ON attendance_justifications (employee_id, ref_date);
CREATE INDEX IF NOT EXISTS attendance_justifications_status_idx ON attendance_justifications (organization_id, status);

DROP TRIGGER IF EXISTS tg_attendance_justifications_updated_at ON attendance_justifications;
CREATE TRIGGER tg_attendance_justifications_updated_at BEFORE UPDATE ON attendance_justifications
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE attendance_justifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_justifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_justifications_rls ON attendance_justifications;
CREATE POLICY attendance_justifications_rls ON attendance_justifications FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_marks (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_date         date NOT NULL,
  status           text NOT NULL,                  -- 'atestado'
  internal_code    text,
  justification_id uuid REFERENCES attendance_justifications(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, ref_date)
);
CREATE INDEX IF NOT EXISTS attendance_marks_emp_idx ON attendance_marks (employee_id, ref_date);

ALTER TABLE attendance_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_marks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_marks_rls ON attendance_marks;
CREATE POLICY attendance_marks_rls ON attendance_marks FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE attendance_justifications IS 'Justificativas de ponto (esqueceu de bater / atestado) pendentes de aprovação.';
COMMENT ON TABLE attendance_marks IS 'Marcações resolvidas por dia (atestado aprovado etc.) usadas no espelho de ponto.';
