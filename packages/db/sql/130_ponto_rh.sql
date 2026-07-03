-- ==============================================================================
-- 130_ponto_rh.sql  (idempotente)  —  PONTO: vínculo com RH, código de barras,
-- avisos e imagem de fundo do painel.
--
-- - ponto_employee ganha vínculo com o funcionário do RH (employees) e um código
--   de barras (EAN-13) pra crachá de marcação.
-- - ponto_config ganha imagem de fundo do painel (com validade).
-- - ponto_notice: avisos exibidos ao bater o ponto (geral ou por funcionário).
-- ==============================================================================

ALTER TABLE ponto_employee
  ADD COLUMN IF NOT EXISTS barcode        text,
  ADD COLUMN IF NOT EXISTS hr_employee_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ponto_employee_barcode_uq ON ponto_employee(organization_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS ponto_employee_hr_idx ON ponto_employee(hr_employee_id);

ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS bg_image_url text,
  ADD COLUMN IF NOT EXISTS bg_until     timestamptz;

CREATE TABLE IF NOT EXISTS ponto_notice (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid REFERENCES ponto_employee(id) ON DELETE CASCADE,  -- null = aviso geral
  message         text NOT NULL,
  until           timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_notice_org_idx ON ponto_notice(organization_id, active);

ALTER TABLE ponto_notice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_notice_rls ON ponto_notice;
CREATE POLICY ponto_notice_rls ON ponto_notice
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
