-- ==============================================================================
-- 145_ponto_holiday.sql  (idempotente)  —  PONTO: Feriados
--
-- Feriados da empresa (nacionais/municipais/folga coletiva). No espelho de ponto,
-- um feriado vira "folga" (não gera FALTA; horas trabalhadas no dia contam como
-- extra). Recorrente = repete todo ano na mesma data (dia/mês).
-- Org-scoped (RLS por organização).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_holiday (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE CASCADE,   -- null = todas as lojas
  day             date NOT NULL,
  name            text NOT NULL,
  recurring       boolean NOT NULL DEFAULT false,                 -- repete todo ano (dia/mês)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ponto_holiday ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_holiday_rls ON ponto_holiday;
CREATE POLICY ponto_holiday_rls ON ponto_holiday
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_ponto_holiday_org ON ponto_holiday (organization_id, day);
