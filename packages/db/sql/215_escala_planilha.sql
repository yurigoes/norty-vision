-- ==============================================================================
-- 215: ESCALA EM MASSA POR PLANILHA, COM VIGÊNCIA POR DATA.
--
-- Portado do Norty RH (migração 256 de lá). Três tabelas:
--
--   ponto_schedule_settings  antecedência mínima (dias) pra subir escala, por empresa.
--     Fica FORA do `ponto_config` de propósito: aquela tabela é replicada nos
--     terminais e não pode ganhar coluna.
--   ponto_schedule_import    cada planilha aplicada (quem, quando, quantas linhas) —
--     é o que permite CONFERIR antes e DESFAZER depois.
--   ponto_schedule_plan      as linhas em si, já por funcionário: "de from_day até
--     to_day (NULL = sem fim), nestes dias da semana, o horário é este".
--     `[]` no padrão = folga. O motor de jornada usa a linha em vigor mais
--     específica; o dia da semana que a planilha NÃO define continua vindo da
--     escala base (`ponto_schedule`).
--
-- Diferenças em relação ao RH, de propósito:
--   · ENABLE + FORCE ROW LEVEL SECURITY e `FOR ALL` nas policies — é a convenção
--     desta base (ver 125_ponto.sql). Sem FORCE, quem conectar como DONO da
--     tabela passa por cima da policy; e aqui as migrations são aplicadas como
--     `postgres`, que é justamente o dono.
--   · os GRANTs já vêm aqui (como no RH), inclusive o da SEQUENCE — `seq` é
--     bigserial, e sem `USAGE` na sequence o INSERT falha com 42501.
-- ==============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ponto_schedule_settings (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  lead_days        int NOT NULL DEFAULT 1 CHECK (lead_days BETWEEN 0 AND 60),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ponto_schedule_import (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'applying' CHECK (status IN ('applying', 'applied', 'undone', 'failed')),
  file_name        text,
  note             text,
  from_day         date,
  to_day           date,
  row_count        int NOT NULL DEFAULT 0,
  employee_count   int NOT NULL DEFAULT 0,
  plan_count       int NOT NULL DEFAULT 0,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  undone_by        uuid,
  undone_at        timestamptz
);
CREATE INDEX IF NOT EXISTS ix_ponto_schedule_import_org ON ponto_schedule_import (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ponto_schedule_plan (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  import_id        uuid REFERENCES ponto_schedule_import(id) ON DELETE CASCADE,
  from_day         date NOT NULL,
  to_day           date,
  pattern          jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"1": [["07:00","10:00"],["10:15","13:00"]], "0": []}  ([] = folga)
  note             text,
  rank             smallint NOT NULL DEFAULT 0,        -- quão específica: 4 CPF · 3 cargo+loja · 2 cargo · 1 loja · 0 todos
  seq              bigserial,                          -- desempate: mesmo início, vale a subida por último
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (to_day IS NULL OR to_day >= from_day)
);
ALTER TABLE ponto_schedule_plan ADD COLUMN IF NOT EXISTS rank smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_ponto_schedule_plan_emp ON ponto_schedule_plan (employee_id, from_day);
CREATE INDEX IF NOT EXISTS ix_ponto_schedule_plan_import ON ponto_schedule_plan (import_id);

ALTER TABLE ponto_schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_schedule_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_schedule_settings_rls ON ponto_schedule_settings;
CREATE POLICY ponto_schedule_settings_rls ON ponto_schedule_settings FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

ALTER TABLE ponto_schedule_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_schedule_import FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_schedule_import_rls ON ponto_schedule_import;
CREATE POLICY ponto_schedule_import_rls ON ponto_schedule_import FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

ALTER TABLE ponto_schedule_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_schedule_plan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_schedule_plan_rls ON ponto_schedule_plan;
CREATE POLICY ponto_schedule_plan_rls ON ponto_schedule_plan FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ponto_schedule_settings, ponto_schedule_import, ponto_schedule_plan TO yugo_app;
GRANT USAGE, SELECT ON SEQUENCE ponto_schedule_plan_seq_seq TO yugo_app;

COMMIT;
