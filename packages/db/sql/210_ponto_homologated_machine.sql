-- 210_ponto_homologated_machine.sql
-- Portado de yugo-ponto (224_request_gate.sql) — renumerado pra sequência do Norty Vision.
-- 224: bloqueio configurável de SOLICITAÇÕES no portal do funcionário.
-- Consulta/visualização sempre liberada; "solicitar" pode exigir: estar no horário
-- permitido E/OU estar numa máquina homologada (identificada por chave/cookie).
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS requests_restrict_hours   boolean NOT NULL DEFAULT false;
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS requests_window_start     text    NOT NULL DEFAULT '08:00';
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS requests_window_end       text    NOT NULL DEFAULT '18:00';
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS requests_window_days      text    NOT NULL DEFAULT '1,2,3,4,5'; -- 0=dom .. 6=sab
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS requests_restrict_machine boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ponto_homologated_machine (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label           text NOT NULL,
  key_hash        text NOT NULL,           -- sha256 da chave (a chave crua só é exibida 1x)
  last_seen_at    timestamptz,
  last_seen_ip    text,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_homologated_machine_org_idx ON ponto_homologated_machine(organization_id);
CREATE INDEX IF NOT EXISTS ponto_homologated_machine_key_idx ON ponto_homologated_machine(key_hash);

ALTER TABLE ponto_homologated_machine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_homologated_machine_rls ON ponto_homologated_machine;
CREATE POLICY ponto_homologated_machine_rls ON ponto_homologated_machine
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
