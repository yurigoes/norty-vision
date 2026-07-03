-- ==============================================================================
-- 076_hr_schedule_flex.sql
-- Escala totalmente configurável por empresa:
--   - hr_settings.default_schedule: modelo semanal padrão (jornada por dia da
--     semana — ex.: seg-sex 08-18, sáb 08-12, dom folga). jsonb:
--     [{weekday:0..6, enabled:bool, startTime:"HH:MM", endTime:"HH:MM", breakMinutes:int}]
--   - hr_holidays: feriados/folgas da empresa (data fixa ou recorrente anual)
--     entram como folga automática na geração da escala.
-- ==============================================================================

ALTER TABLE hr_settings ADD COLUMN IF NOT EXISTS default_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS hr_holidays (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holiday_date     date NOT NULL,
  name             text,
  recurring_annual boolean NOT NULL DEFAULT false,   -- repete todo ano (mesmo dia/mês)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_holidays_org_idx ON hr_holidays (organization_id, holiday_date);

ALTER TABLE hr_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_holidays FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_holidays_rls ON hr_holidays;
CREATE POLICY hr_holidays_rls ON hr_holidays FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON COLUMN hr_settings.default_schedule IS 'Modelo semanal padrão da empresa (jornada por dia da semana).';
COMMENT ON TABLE hr_holidays IS 'Feriados/folgas da empresa (folga automática na escala).';
