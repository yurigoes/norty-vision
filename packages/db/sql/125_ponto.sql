-- ==============================================================================
-- 125_ponto.sql  (idempotente)  —  PONTO ELETRÔNICO (REP-A) Fase 0
--
-- Fundação: config do empregador, funcionários, marcações (com NSR + horário do
-- servidor + hash encadeado pra integridade) e trilha de auditoria append-only.
-- Marcação é IMUTÁVEL (Portaria 671): nunca alterar/apagar; ajuste = registro novo.
-- Isolado por empresa (RLS). AFD/AEJ e motor de jornada vêm nas fases seguintes.
-- ==============================================================================

-- Config do empregador (1 por empresa) — base do cabeçalho do AFD/AEJ.
CREATE TABLE IF NOT EXISTS ponto_config (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  tp_idt_empregador smallint NOT NULL DEFAULT 1,           -- 1=CNPJ, 2=CPF
  idt_empregador    text,                                  -- CNPJ/CPF (só dígitos)
  caepf             text,
  cno               text,
  razao_ou_nome     text,
  rep_a_processo    text,                                  -- nº processo convenção/acordo (REP-A); senão 9x17
  timezone          text NOT NULL DEFAULT '-0300',
  last_nsr          bigint NOT NULL DEFAULT 0,             -- sequencial de marcação por empresa
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ponto_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_config_rls ON ponto_config;
CREATE POLICY ponto_config_rls ON ponto_config FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Funcionários do ponto.
CREATE TABLE IF NOT EXISTS ponto_employee (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  name            text NOT NULL,
  cpf             text,
  pis             text,
  matricula       text,
  mat_esocial     text,
  cargo           text,
  schedule_code   text,                                   -- código do horário contratual (AEJ reg 04)
  pin_hash        text,                                   -- PIN p/ marcar em dispositivo compartilhado (sha256)
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_employee_org_idx ON ponto_employee (organization_id);
CREATE INDEX IF NOT EXISTS ponto_employee_cpf_idx ON ponto_employee (organization_id, cpf);
ALTER TABLE ponto_employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_employee FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_employee_rls ON ponto_employee;
CREATE POLICY ponto_employee_rls ON ponto_employee FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Marcações (imutáveis). NSR + horário do servidor + hash encadeado.
CREATE TABLE IF NOT EXISTS ponto_punch (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  nsr             bigint NOT NULL,
  punched_at      timestamptz NOT NULL DEFAULT now(),     -- HORÁRIO DO SERVIDOR
  device_at       timestamptz,                            -- horário informado pelo dispositivo (offline)
  origin          text NOT NULL DEFAULT 'web',            -- web|pwa|kiosk
  source          text NOT NULL DEFAULT 'O',              -- O=original|I=manual|P=pré-assinalada|X=exceção|T=outras
  ip              text,
  device          text,
  photo_url       text,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  offline         boolean NOT NULL DEFAULT false,
  motivo          text,                                   -- obrigatório p/ inclusão manual (AEJ)
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  prev_hash       text,
  hash            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ponto_punch_org_nsr_uk ON ponto_punch (organization_id, nsr);
CREATE INDEX IF NOT EXISTS ponto_punch_emp_idx ON ponto_punch (employee_id, punched_at);
ALTER TABLE ponto_punch ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_punch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_punch_rls ON ponto_punch;
CREATE POLICY ponto_punch_rls ON ponto_punch FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Trilha de auditoria append-only (quem fez o quê).
CREATE TABLE IF NOT EXISTS ponto_audit (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action          text NOT NULL,
  entity          text,
  entity_id       uuid,
  performed_by    text,
  ip              text,
  detail          jsonb,
  prev_hash       text,
  hash            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_audit_org_idx ON ponto_audit (organization_id, created_at);
ALTER TABLE ponto_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_audit_rls ON ponto_audit;
CREATE POLICY ponto_audit_rls ON ponto_audit FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
