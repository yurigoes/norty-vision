-- ==============================================================================
-- 132_ponto_bh_aej.sql  (idempotente)  —  PONTO Fase 4: banco de horas + fechamento
--
-- - ponto_bank_movement: lançamentos do banco de horas (saldo +/- por dia).
-- - ponto_closing: fechamento mensal (gestor → RH → exportação) com resumo.
-- O AEJ é gerado em runtime (registros 01–08 + 99) e assinado no .p7s (cert A1).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_bank_movement (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  day                 date NOT NULL,
  minutes             integer NOT NULL,                 -- + inclusão (crédito) / - compensação (débito)
  kind                text NOT NULL DEFAULT 'inclusion', -- inclusion | compensation | expiry
  reason              text,
  created_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_bank_mov_emp_idx ON ponto_bank_movement(organization_id, employee_id, day);

ALTER TABLE ponto_bank_movement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_bank_movement_rls ON ponto_bank_movement;
CREATE POLICY ponto_bank_movement_rls ON ponto_bank_movement
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS ponto_closing (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ref_month         date NOT NULL,                      -- 1º dia do mês de referência
  status            text NOT NULL DEFAULT 'open',       -- open | manager | closed
  summary           jsonb,                              -- totais por funcionário (snapshot do fechamento)
  manager_at        timestamptz,
  manager_by        uuid,
  hr_at             timestamptz,
  hr_by             uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ref_month)
);
CREATE INDEX IF NOT EXISTS ponto_closing_org_idx ON ponto_closing(organization_id, ref_month);

ALTER TABLE ponto_closing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_closing_rls ON ponto_closing;
CREATE POLICY ponto_closing_rls ON ponto_closing
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
