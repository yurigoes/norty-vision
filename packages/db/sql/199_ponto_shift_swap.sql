-- 199_ponto_shift_swap.sql
-- Portado de yugo-ponto (186_shift_swap.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 186_shift_swap.sql  (idempotente)  —  Troca de turno/folga com tripla assinatura
--
-- Fluxo: funcionário A solicita troca a um colega B (escolhe a data e o tipo:
--   'horario' = mesma data, A e B trocam os turnos do dia;
--   'folga'   = A quer folgar na data X e cobre a data Y do colega (duas datas)).
-- B aceita e assina → líder (Employee.leader_id, fallback RH) aprova e assina →
-- RH anexa documento e APLICA → a escala dos dois é trocada na(s) data(s) via
-- ponto_schedule_override (consultado pelo espelho). Três assinaturas (A1 ICP ou
-- contingência por hash). Regras: 48h de antecedência, 11h de intervalo, DSR.
--
-- ponto_schedule_override: exceção pontual da escala por dia (folga ou turno).
-- Marcação continua imutável (Portaria 671) — isto altera apenas o ESPERADO.
-- ==============================================================================

-- Exceção de escala por dia (sobrepõe o pattern da ponto_schedule só naquele dia).
CREATE TABLE IF NOT EXISTS ponto_schedule_override (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  day             date NOT NULL,
  kind            text NOT NULL DEFAULT 'work',          -- 'work' (usa segments) | 'folga' (sem jornada)
  segments        jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [["08:00","12:00"],["13:00","17:00"]]
  source          text NOT NULL DEFAULT 'manual',         -- 'swap' | 'manual'
  source_id       uuid,                                   -- id da troca que gerou
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_id, day)
);
CREATE INDEX IF NOT EXISTS ponto_schedule_override_emp_idx ON ponto_schedule_override(organization_id, employee_id, day);

-- Troca de turno/folga (ciclo completo com tripla assinatura).
CREATE TABLE IF NOT EXISTS ponto_shift_swap (
  id                    uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- partes (employees do RH; os ponto_employee são resolvidos na aplicação)
  requester_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  colleague_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leader_employee_id    uuid REFERENCES employees(id) ON DELETE SET NULL,  -- null => aprova o RH
  swap_type             text NOT NULL DEFAULT 'horario',  -- 'horario' (mesma data) | 'folga' (duas datas)
  swap_date             date NOT NULL,                    -- data principal (A quer folgar / trocar turno)
  counterpart_date      date,                             -- folga: data em que A cobre o colega
  reason                text,
  -- estado: pending_colleague -> pending_leader -> approved -> applied | rejected | canceled
  status                text NOT NULL DEFAULT 'pending_colleague',
  -- assinatura do solicitante (A) — feita no ato do pedido
  requester_signed_at   timestamptz,
  requester_sig_hash    text,
  requester_a1          boolean NOT NULL DEFAULT false,
  requester_p7s_key     text,
  -- assinatura do colega (B)
  colleague_signed_at   timestamptz,
  colleague_sig_hash    text,
  colleague_a1          boolean NOT NULL DEFAULT false,
  colleague_p7s_key     text,
  colleague_note        text,
  -- assinatura do líder
  leader_signed_at      timestamptz,
  leader_sig_hash       text,
  leader_a1             boolean NOT NULL DEFAULT false,
  leader_p7s_key        text,
  leader_note           text,
  approved_by_rh        boolean NOT NULL DEFAULT false,    -- true se quem aprovou foi o RH (sem líder)
  -- RH: anexo + aplicação
  rh_attachment_url     text,
  rh_user_id            uuid,
  applied_at            timestamptz,
  rejected_by           text,                              -- 'colleague' | 'leader' | 'rh'
  reject_reason         text,
  -- regras avaliadas no momento da decisão (auditoria)
  rule_warnings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_shift_swap_org_idx ON ponto_shift_swap(organization_id, status);
CREATE INDEX IF NOT EXISTS ponto_shift_swap_req_idx ON ponto_shift_swap(requester_employee_id);
CREATE INDEX IF NOT EXISTS ponto_shift_swap_col_idx ON ponto_shift_swap(colleague_employee_id);
CREATE INDEX IF NOT EXISTS ponto_shift_swap_led_idx ON ponto_shift_swap(leader_employee_id);

-- RLS
ALTER TABLE ponto_schedule_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_shift_swap        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ponto_schedule_override_rls ON ponto_schedule_override;
CREATE POLICY ponto_schedule_override_rls ON ponto_schedule_override
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

DROP POLICY IF EXISTS ponto_shift_swap_rls ON ponto_shift_swap;
CREATE POLICY ponto_shift_swap_rls ON ponto_shift_swap
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
