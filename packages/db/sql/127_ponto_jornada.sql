-- ==============================================================================
-- 127_ponto_jornada.sql  (idempotente)  —  PONTO Fase 1: motor de jornada
--
-- Escalas (fixa / 12x36) + justificativas com aprovação do gestor. O espelho de
-- ponto e o cálculo (horas normais/extras/atraso/falta/adic. noturno/saldo) são
-- derivados em tempo de consulta a partir das marcações + escala — nada de
-- recalcular/alterar a marcação (Portaria 671: marcação é imutável).
-- ==============================================================================

-- Escala de trabalho (referenciada por ponto_employee.schedule_code).
CREATE TABLE IF NOT EXISTS ponto_schedule (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,                       -- casa com ponto_employee.schedule_code
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'fixa',         -- 'fixa' | '12x36'
  tolerance_min   smallint NOT NULL DEFAULT 10,         -- tolerância por marcação (CLT art. 58 §1)
  night_start     text NOT NULL DEFAULT '22:00',        -- início do adicional noturno
  night_end       text NOT NULL DEFAULT '05:00',        -- fim do adicional noturno
  -- pattern: fixa => { "0":[["08:00","12:00"],["13:00","17:00"]], ... "6":[] }  (0=domingo)
  --          12x36 => { "anchor":"2026-01-01", "segments":[["07:00","19:00"]] } (dia de trabalho na âncora)
  pattern         jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS ponto_schedule_org_idx ON ponto_schedule(organization_id);

-- Justificativa de divergência num dia (atraso/falta/saída antecipada/abono).
CREATE TABLE IF NOT EXISTS ponto_justification (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  day             date NOT NULL,                        -- dia da divergência (data local)
  kind            text NOT NULL,                        -- 'atraso'|'falta'|'saida_antecipada'|'abono'|'extra'|'outro'
  reason          text NOT NULL,
  attachment_url  text,
  status          text NOT NULL DEFAULT 'pending',      -- 'pending'|'approved'|'rejected'
  requested_by    uuid,                                 -- user que pediu
  reviewed_by     uuid,                                 -- gestor que decidiu
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_justification_emp_idx ON ponto_justification(organization_id, employee_id, day);

-- RLS
ALTER TABLE ponto_schedule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_justification  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ponto_schedule_rls ON ponto_schedule;
CREATE POLICY ponto_schedule_rls ON ponto_schedule
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

DROP POLICY IF EXISTS ponto_justification_rls ON ponto_justification;
CREATE POLICY ponto_justification_rls ON ponto_justification
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
