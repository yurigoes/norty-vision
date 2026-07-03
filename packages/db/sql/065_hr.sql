-- ==============================================================================
-- 065_hr.sql
-- Módulo RH + portal do funcionário (MVP forte):
--   - employees: ficha do funcionário (cargo, salário, admissão, jornada, loja)
--   - employee_sessions: login do portal (CPF + senha, 1º acesso troca senha)
--   - employee_documents: cofre de documentos (bucket privado)
--   - payslips: holerite (PDF importado) com ciência/assinatura do funcionário
--   - time_entries: batidas de ponto (selfie + IP + geo)
--   - time_sheets: espelho de ponto mensal assinado
--   - hr_requests: solicitações (férias, vale ≤40%, troca de horário) c/ aprovação
--   - work_shifts: escala por loja/dia
--   - hr_notices: mural de avisos
-- Tudo escopado por organização (RLS).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- employees — ficha + auth do portal
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id           uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,  -- se também é usuário do sistema

  name               text NOT NULL,
  cpf                text,                       -- só dígitos
  rg                 text,
  birth_date         date,
  phone              text,
  whatsapp_phone     text,
  email              text,

  address_line       text,
  address_number     text,
  address_complement text,
  neighborhood       text,
  city               text,
  state              char(2),
  postal_code        text,

  role_title         text,                       -- cargo
  cbo                text,                        -- código CBO
  salary_cents       bigint,
  admission_date     date,
  termination_date   date,
  work_schedule      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- jornada (dias/horários)
  photo_url          text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','terminated')),

  -- auth portal
  password_hash      text,
  must_reset_password boolean NOT NULL DEFAULT true,
  portal_last_login_at timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_org_cpf_uidx ON employees (organization_id, cpf) WHERE cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_org_idx ON employees (organization_id, status);

DROP TRIGGER IF EXISTS tg_employees_updated_at ON employees;
CREATE TRIGGER tg_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_rls ON employees;
CREATE POLICY employees_rls ON employees FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- employee_sessions — cookie httpOnly do portal do funcionário
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_sessions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  ip_address      inet,
  user_agent      text,
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_sessions_emp_idx ON employee_sessions (employee_id);

ALTER TABLE employee_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_sessions_rls ON employee_sessions;
CREATE POLICY employee_sessions_rls ON employee_sessions FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- employee_documents — cofre de documentos do funcionário (bucket privado)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_documents (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type        text NOT NULL DEFAULT 'other',  -- ctps,rg,cpf,address,aso,contract,medical,other
  title           text,
  file_url        text NOT NULL,                  -- "priv:<key>" ou url pública
  uploaded_by     text NOT NULL DEFAULT 'company', -- company | employee
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_documents_emp_idx ON employee_documents (employee_id);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_documents_rls ON employee_documents;
CREATE POLICY employee_documents_rls ON employee_documents FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- payslips — holerite com ciência/assinatura
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payslips (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_month       date NOT NULL,                  -- 1º dia do mês de referência
  gross_cents     bigint,
  net_cents       bigint,
  file_url        text,                           -- PDF do holerite (priv ou público)
  notes           text,
  acknowledged_at timestamptz,                    -- ciência/assinatura do funcionário
  signature_image_url text,
  signer_ip       inet,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payslips_emp_month_uidx ON payslips (employee_id, ref_month);

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payslips_rls ON payslips;
CREATE POLICY payslips_rls ON payslips FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- time_entries — batidas de ponto (selfie + IP + geo)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('in','out','break_in','break_out')),
  happened_at     timestamptz NOT NULL DEFAULT now(),
  selfie_url      text,
  ip_address      inet,
  lat             double precision,
  lng             double precision,
  accuracy_m      double precision,
  source          text NOT NULL DEFAULT 'portal', -- portal | manager_adjust
  adjusted        boolean NOT NULL DEFAULT false,
  adjusted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_emp_idx ON time_entries (employee_id, happened_at);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_entries_rls ON time_entries;
CREATE POLICY time_entries_rls ON time_entries FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- time_sheets — espelho de ponto mensal assinado
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_sheets (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ref_month       date NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','signed')),
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- horas totais, extras, faltas
  signed_at       timestamptz,
  signature_image_url text,
  signer_ip       inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS time_sheets_emp_month_uidx ON time_sheets (employee_id, ref_month);

DROP TRIGGER IF EXISTS tg_time_sheets_updated_at ON time_sheets;
CREATE TRIGGER tg_time_sheets_updated_at BEFORE UPDATE ON time_sheets
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE time_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_sheets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_sheets_rls ON time_sheets;
CREATE POLICY time_sheets_rls ON time_sheets FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- hr_requests — solicitações (férias, vale ≤40%, troca de horário)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_requests (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('vacation','advance','shift_swap','absence_justify')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- datas, motivo, colega, etc.
  amount_cents    bigint,                              -- vale/adiantamento
  attachment_url  text,                                -- atestado/comprovante
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','canceled')),
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_requests_org_idx ON hr_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS hr_requests_emp_idx ON hr_requests (employee_id);

DROP TRIGGER IF EXISTS tg_hr_requests_updated_at ON hr_requests;
CREATE TRIGGER tg_hr_requests_updated_at BEFORE UPDATE ON hr_requests
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE hr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_requests_rls ON hr_requests;
CREATE POLICY hr_requests_rls ON hr_requests FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- work_shifts — escala por loja/dia
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_shifts (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_date      date NOT NULL,
  start_time      text,                            -- "08:00"
  end_time        text,                            -- "18:00"
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_shifts_org_date_idx ON work_shifts (organization_id, shift_date);
CREATE INDEX IF NOT EXISTS work_shifts_emp_idx ON work_shifts (employee_id, shift_date);

ALTER TABLE work_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_shifts_rls ON work_shifts;
CREATE POLICY work_shifts_rls ON work_shifts FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- hr_notices — mural de avisos
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_notices (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,  -- null = todas as lojas
  title           text NOT NULL,
  body            text NOT NULL,
  pinned          boolean NOT NULL DEFAULT false,
  published_at    timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_notices_org_idx ON hr_notices (organization_id, published_at);

ALTER TABLE hr_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_notices_rls ON hr_notices;
CREATE POLICY hr_notices_rls ON hr_notices FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE employees IS 'Ficha do funcionário + auth do portal do funcionário (RH).';
COMMENT ON TABLE time_entries IS 'Batidas de ponto com selfie, IP e geolocalização.';
COMMENT ON TABLE hr_requests IS 'Solicitações do funcionário (férias, vale ≤40%, troca de horário) com aprovação.';
