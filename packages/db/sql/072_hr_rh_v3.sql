-- ==============================================================================
-- 072_hr_rh_v3.sql
-- RH "completo":
--   - employee_documents: tipo (CLT) + aprovação (pendente/aprovado/recusado)
--   - time_entries: pedido de edição da batida pelo funcionário (pendente p/ supervisão)
--   - hr_requests: comprovante de pagamento (vale/reembolso) inserido pelo admin
--   - employee_loans + employee_loan_installments: empréstimos parcelados
--     (parcela < 30% do salário), pagos junto/pelo holerite, acompanhados como crediário
-- ==============================================================================

-- ---- documentos: aprovação ----
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS review_note text;
-- docs enviados pelo funcionário entram como pendentes; os do admin já aprovados
-- (default 'approved' cobre os já existentes).

-- ---- ponto: pedido de edição (funcionário) ----
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS edit_status text NOT NULL DEFAULT 'none'
  CHECK (edit_status IN ('none','pending','approved','rejected'));
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS edit_requested_to timestamptz;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS edit_reason text;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS edit_requested_at timestamptz;

-- ---- solicitações: comprovante de pagamento (admin) ----
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS payment_proof_url text;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- ---- empréstimos ----
CREATE TABLE IF NOT EXISTS employee_loans (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  principal_cents    bigint NOT NULL,
  installments_count int NOT NULL CHECK (installments_count BETWEEN 1 AND 120),
  installment_cents  bigint NOT NULL,
  first_due_month    date NOT NULL,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','canceled')),
  notes              text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_loans_emp_idx ON employee_loans (employee_id, status);

DROP TRIGGER IF EXISTS tg_employee_loans_updated_at ON employee_loans;
CREATE TRIGGER tg_employee_loans_updated_at BEFORE UPDATE ON employee_loans
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_loans_rls ON employee_loans;
CREATE POLICY employee_loans_rls ON employee_loans FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS employee_loan_installments (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  loan_id         uuid NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  number          int NOT NULL,
  due_month       date NOT NULL,
  amount_cents    bigint NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at         timestamptz,
  payslip_id      uuid REFERENCES payslips(id) ON DELETE SET NULL,
  proof_url       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_inst_loan_idx ON employee_loan_installments (loan_id, number);
CREATE INDEX IF NOT EXISTS loan_inst_emp_idx ON employee_loan_installments (employee_id, status);

ALTER TABLE employee_loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loan_installments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_loan_installments_rls ON employee_loan_installments;
CREATE POLICY employee_loan_installments_rls ON employee_loan_installments FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE employee_loans IS 'Empréstimos a funcionários (parcela < 30% do salário), acompanhados como crediário.';
