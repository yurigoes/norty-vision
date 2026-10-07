-- 209_ponto_bank_request.sql
-- Portado de yugo-ponto (223_bank_visibility.sql) — renumerado pra sequência do Norty Vision.
-- 223: visualização do saldo de banco de horas pelo funcionário (configurável)
-- + solicitação ao RH quando oculto (somente RH vê/responde; o líder NÃO vê).
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS show_bank_to_employee boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS ponto_bank_request (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ponto_employee_id   uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reason              text,
  response_note       text,
  balance_min         integer,            -- saldo divulgado (snapshot ao responder)
  requested_at        timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz,
  responded_by_user_id uuid
);
CREATE INDEX IF NOT EXISTS ponto_bank_request_org_idx ON ponto_bank_request(organization_id, status);
CREATE INDEX IF NOT EXISTS ponto_bank_request_emp_idx ON ponto_bank_request(ponto_employee_id);

ALTER TABLE ponto_bank_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_bank_request_rls ON ponto_bank_request;
CREATE POLICY ponto_bank_request_rls ON ponto_bank_request
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
