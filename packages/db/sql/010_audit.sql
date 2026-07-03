-- ==============================================================================
-- 010_audit.sql
-- Auditoria: audit_log particionado por mes, data_access_log (LGPD).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- AUDIT_LOG - log append-only de TODA acao sensivel
-- Particionado por mes para escalar (TBs).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- contexto
  organization_id uuid,                                    -- nullable: acoes da plataforma
  store_id        uuid,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  as_platform_admin boolean NOT NULL DEFAULT false,        -- usado modo super-admin?

  -- acao
  action          text NOT NULL,                          -- 'login','user.create','appointment.cancel',...
  resource_type   text,                                   -- 'appointment','user','campaign'
  resource_id     uuid,

  -- payload (estado antes/depois quando relevante)
  before          jsonb,
  after           jsonb,
  diff            jsonb,                                  -- gerado pela app (opcional)
  reason          text,                                   -- justificativa em acoes que pedem

  -- request
  request_id      text,                                   -- correlation id
  ip_address      inet,
  user_agent      text,

  -- categoria
  severity        text NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('debug','info','warn','error','critical')),

  -- PK composta: timestamp + id (para particionamento + ordenacao)
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS audit_log_org_time_idx
  ON audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON audit_log (resource_type, resource_id, created_at DESC) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_severity_idx
  ON audit_log (severity, created_at DESC) WHERE severity IN ('warn','error','critical');

COMMENT ON TABLE audit_log IS
  'Log append-only de acoes sensiveis. Particionado por mes. UPDATEs nao permitidos (trigger bloqueia).';

-- bloqueia UPDATE/DELETE (append-only)
CREATE OR REPLACE FUNCTION app.tg_block_modification() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log e append-only; UPDATE/DELETE nao permitidos';
END;
$$;

DROP TRIGGER IF EXISTS tg_audit_log_no_update ON audit_log;
CREATE TRIGGER tg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.tg_block_modification();

-- particao default (catch-all pra rows inesperados; partitions reais sao
-- criadas mensalmente pelo job de manutencao)
CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

-- funcao que cria particao mensal (chamada pelo worker uma vez por mes)
CREATE OR REPLACE FUNCTION app.audit_log_ensure_partition(p_month date) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  partition_name text;
  range_start text;
  range_end text;
BEGIN
  partition_name := 'audit_log_' || to_char(p_month, 'YYYY_MM');
  range_start := to_char(date_trunc('month', p_month), 'YYYY-MM-DD');
  range_end   := to_char(date_trunc('month', p_month) + INTERVAL '1 month', 'YYYY-MM-DD');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
    partition_name, range_start, range_end
  );
END;
$$;

-- garante particoes do mes atual e proximos 2 meses (futuro)
DO $$
BEGIN
  PERFORM app.audit_log_ensure_partition(date_trunc('month', now())::date);
  PERFORM app.audit_log_ensure_partition((date_trunc('month', now()) + INTERVAL '1 month')::date);
  PERFORM app.audit_log_ensure_partition((date_trunc('month', now()) + INTERVAL '2 months')::date);
END
$$;

-- ------------------------------------------------------------------------------
-- DATA_ACCESS_LOG - quem leu dados pessoais quando (LGPD)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_access_log (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),

  organization_id uuid,
  store_id        uuid,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,

  -- recurso acessado
  subject_type    text NOT NULL,                          -- 'customer','lead','appointment'
  subject_id      uuid NOT NULL,

  -- escopo do acesso
  fields          text[] NOT NULL DEFAULT '{}',           -- campos lidos (se rastreaveis)
  purpose         text NOT NULL,                          -- 'view_profile','export','marketing','support'

  -- req metadata
  request_id      text,
  ip_address      inet,
  user_agent      text
);

CREATE INDEX IF NOT EXISTS data_access_log_subject_idx
  ON data_access_log (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS data_access_log_actor_idx
  ON data_access_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS data_access_log_org_idx
  ON data_access_log (organization_id, created_at DESC);

COMMENT ON TABLE data_access_log IS
  'Trail LGPD: quem visualizou/exportou dados pessoais. Append-only.';

DROP TRIGGER IF EXISTS tg_data_access_log_no_update ON data_access_log;
CREATE TRIGGER tg_data_access_log_no_update
  BEFORE UPDATE OR DELETE ON data_access_log
  FOR EACH ROW EXECUTE FUNCTION app.tg_block_modification();
