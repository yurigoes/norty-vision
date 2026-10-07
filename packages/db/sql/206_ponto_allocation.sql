-- 206_ponto_allocation.sql
-- Portado de yugo-ponto (220_ponto_allocation.sql) — renumerado pra sequência do Norty Vision.
-- 220: Alocação / cessão de mão de obra cross-tenant.
-- A empresa A (owner_org_id) é a EMPREGADORA legal (holerite/AFD/eSocial ficam em A).
-- O funcionário fica ALOCADO na empresa B (borrower_org_id), outro tenant do SaaS,
-- que enxerga (somente leitura) os alocados e suas batidas no período da alocação.
CREATE TABLE IF NOT EXISTS ponto_allocation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, -- empregadora (A)
  borrower_org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, -- tomadora (B)
  ponto_employee_id  uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  posto              text,                       -- posto/local de trabalho no tomador (livre)
  starts_at          date NOT NULL,
  ends_at            date,                        -- NULL = sem prazo
  status             text NOT NULL DEFAULT 'active', -- active | ended | cancelled
  bill_rate_cents    bigint,                      -- valor/hora a faturar ao tomador (opcional)
  reason             text,
  authorized_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_org_id <> borrower_org_id)
);
CREATE INDEX IF NOT EXISTS ponto_allocation_owner_idx    ON ponto_allocation(owner_org_id, status);
CREATE INDEX IF NOT EXISTS ponto_allocation_borrower_idx ON ponto_allocation(borrower_org_id, status);
CREATE INDEX IF NOT EXISTS ponto_allocation_emp_idx      ON ponto_allocation(ponto_employee_id);

ALTER TABLE ponto_allocation ENABLE ROW LEVEL SECURITY;

-- A empregadora (owner) tem acesso total às suas alocações.
DROP POLICY IF EXISTS ponto_allocation_owner ON ponto_allocation;
CREATE POLICY ponto_allocation_owner ON ponto_allocation
  USING (app.is_platform_admin() OR owner_org_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR owner_org_id = app.current_org_id());

-- A tomadora (borrower) só LÊ as alocações vigentes destinadas a ela (sem escrever).
DROP POLICY IF EXISTS ponto_allocation_borrower_read ON ponto_allocation;
CREATE POLICY ponto_allocation_borrower_read ON ponto_allocation
  FOR SELECT
  USING (
    borrower_org_id = app.current_org_id()
    AND status = 'active'
    AND starts_at <= current_date
    AND (ends_at IS NULL OR ends_at >= current_date)
  );
