-- ==============================================================================
-- 066_hr_v2.sql
-- RH parte 2:
--   - time_entries: preserva a batida ORIGINAL (imutável, exigida na Portaria
--     671/2021 — espelho de ponto). O ajuste do supervisor altera happened_at
--     (versão "ajustada") mas guarda original_happened_at + motivo.
--   - hr_settings: data de fechamento/pagamento da folha por empresa.
-- ==============================================================================

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS original_happened_at timestamptz;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS adjust_reason text;

-- backfill: marca original = happened_at pra batidas que ainda não têm
UPDATE time_entries SET original_happened_at = happened_at WHERE original_happened_at IS NULL;

-- ------------------------------------------------------------------------------
-- hr_settings — fechamento de folha por empresa (1 linha por org)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_settings (
  organization_id   uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  closing_day       int NOT NULL DEFAULT 30 CHECK (closing_day BETWEEN 1 AND 31),  -- dia de corte da competência
  payment_day       int NOT NULL DEFAULT 5  CHECK (payment_day BETWEEN 1 AND 31),  -- dia do pagamento
  daily_hours       numeric(4,2) NOT NULL DEFAULT 8.0,   -- jornada diária padrão (p/ banco de horas)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_hr_settings_updated_at ON hr_settings;
CREATE TRIGGER tg_hr_settings_updated_at BEFORE UPDATE ON hr_settings
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE hr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_settings_rls ON hr_settings;
CREATE POLICY hr_settings_rls ON hr_settings FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON COLUMN time_entries.original_happened_at IS 'Batida original imutável (espelho de ponto legal). happened_at é a versão ajustada pelo supervisor.';
COMMENT ON TABLE hr_settings IS 'Config de RH por empresa: dia de fechamento e pagamento da folha + jornada diária.';
