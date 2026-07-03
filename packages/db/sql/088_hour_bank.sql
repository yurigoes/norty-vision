-- ==============================================================================
-- 088_hour_bank.sql  (idempotente)
--
-- Banco de horas (BH) por funcionário.
--   - hour_bank_entries: razão (ledger) de lançamentos em minutos (+/-):
--       kind: 'auto_extra' (hora extra apurada), 'auto_debit' (faltou hora),
--             'compensation' (compensar débito com BH), 'manual' (ajuste do admin),
--             'paid_adjust' (operador pagou pra zerar débito além do limite).
--       status: 'pending' (extra aguardando aprovação), 'approved', 'rejected',
--               'applied' (já entrou no saldo).
--   - hr_settings ganha limite de BH negativo (default 6h = 360 min) e flags.
--
-- O saldo do funcionário = soma de minutes das entries com status in
-- ('approved','applied'). O cálculo do dia (esperado x trabalhado) é feito no
-- backend a partir de work_shifts + time_entries.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS hour_bank_entries (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_date          date NOT NULL,
  minutes           int  NOT NULL,                 -- + crédito (extra) / - débito
  kind              text NOT NULL
                    CHECK (kind IN ('auto_extra','auto_debit','compensation','manual','paid_adjust')),
  status            text NOT NULL DEFAULT 'applied'
                    CHECK (status IN ('pending','approved','rejected','applied')),
  source            text NOT NULL DEFAULT 'auto'
                    CHECK (source IN ('auto','manual')),
  work_shift_id     uuid REFERENCES work_shifts(id) ON DELETE SET NULL,
  reason            text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hour_bank_entries_emp_idx ON hour_bank_entries (employee_id, ref_date DESC);
CREATE INDEX IF NOT EXISTS hour_bank_entries_org_status_idx ON hour_bank_entries (organization_id, status);
-- 1 lançamento automático por dia/tipo (idempotente ao reapurar)
CREATE UNIQUE INDEX IF NOT EXISTS hour_bank_entries_auto_uq
  ON hour_bank_entries (employee_id, ref_date, kind) WHERE source = 'auto';

DROP TRIGGER IF EXISTS tg_hour_bank_entries_updated_at ON hour_bank_entries;
CREATE TRIGGER tg_hour_bank_entries_updated_at BEFORE UPDATE ON hour_bank_entries
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE hour_bank_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hour_bank_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hour_bank_entries_rls ON hour_bank_entries;
CREATE POLICY hour_bank_entries_rls ON hour_bank_entries FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- limites/flags do banco de horas na config da org
ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS hour_bank_enabled         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hour_bank_negative_limit_min int NOT NULL DEFAULT 360,  -- 6h
  ADD COLUMN IF NOT EXISTS extra_needs_approval      boolean NOT NULL DEFAULT true,
  -- tolerância (min) p/ não gerar BH em pequenas diferenças de batida
  ADD COLUMN IF NOT EXISTS hour_bank_tolerance_min   int NOT NULL DEFAULT 10;

-- status apurado e saldo do dia no próprio work_shift (alimenta o calendário)
ALTER TABLE work_shifts
  ADD COLUMN IF NOT EXISTS worked_minutes   int,
  ADD COLUMN IF NOT EXISTS expected_minutes int,
  ADD COLUMN IF NOT EXISTS balance_minutes  int,
  ADD COLUMN IF NOT EXISTS day_status       text;  -- not_registered|off|ok|adjusted|extra|debit
