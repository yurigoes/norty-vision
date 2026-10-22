-- ==============================================================================
-- 216: EXTRAS (diarista / hora extra avulsa fora da escala oficial).
--
-- Portado do Norty RH (migração 241 de lá).
--
-- O fluxo: o DP escala a pessoa pra um dia específico e define o valor da
-- diária -> sai na hora um recibo A4 com 2 vias pra assinar. No dia, ela bate
-- no terminal normalmente; como existe uma escalação de extra pra hoje, a
-- batida cai SÓ nesta tabela paralela (`ponto_extra_punch`) — NUNCA em
-- `ponto_punch`, NUNCA no AFD/eSocial, NUNCA na escala oficial. E isso é
-- garantido POR CONSTRUÇÃO: tabela fisicamente separada, não uma flag numa
-- tabela compartilhada que alguém esquece de filtrar. Depois, com o papel
-- assinado em mãos, o DP confirma: pago / trabalhou mas não pago / não
-- compareceu — três categorias que o relatório não mistura.
--
-- Três diferenças em relação ao RH, de propósito:
--   · `app.new_id()` no lugar de `gen_random_uuid()` — é o default desta base.
--   · ENABLE + FORCE ROW LEVEL SECURITY e `FOR ALL` nas policies. Sem FORCE,
--     quem conecta como DONO da tabela passa por cima da policy, e aqui as
--     migrations são aplicadas como `postgres`, que é justamente o dono.
--   · OS GRANTS. A migração do RH não tem nenhum, e esta roda DEPOIS do
--     `019_grants_refresh.sql` — então sem eles a API responderia
--     `42501 permission denied for table ponto_extra_shift`, que é exatamente
--     o erro que parou o ponto da produção semana passada.
-- ==============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ponto_extra_shift (
  id                     uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ponto_employee_id      uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  store_id               uuid,
  work_date              date NOT NULL,
  daily_value_cents      bigint NOT NULL DEFAULT 0,
  note                   text,
  -- 'escalado' (aguardando o dia/confirmação) | 'pago' | 'nao_pago' | 'nao_compareceu'
  status                 text NOT NULL DEFAULT 'escalado',
  document_generated_at  timestamptz,
  status_confirmed_at    timestamptz,
  status_confirmed_by    uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ponto_employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS ponto_extra_shift_org_date_idx ON ponto_extra_shift(organization_id, work_date);
CREATE INDEX IF NOT EXISTS ponto_extra_shift_emp_idx ON ponto_extra_shift(ponto_employee_id);
CREATE INDEX IF NOT EXISTS ponto_extra_shift_status_idx ON ponto_extra_shift(organization_id, status);

-- Batida real do dia (pode ter mais de uma — entrada/saída). Presa à escalação,
-- nunca à tabela oficial de ponto.
CREATE TABLE IF NOT EXISTS ponto_extra_punch (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  extra_shift_id   uuid NOT NULL REFERENCES ponto_extra_shift(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  punched_at       timestamptz NOT NULL DEFAULT now(),
  photo_url        text,
  device_id        uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_extra_punch_shift_idx ON ponto_extra_punch(extra_shift_id);

ALTER TABLE ponto_extra_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_extra_shift FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_extra_shift_rls ON ponto_extra_shift;
CREATE POLICY ponto_extra_shift_rls ON ponto_extra_shift FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

ALTER TABLE ponto_extra_punch ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_extra_punch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_extra_punch_rls ON ponto_extra_punch;
CREATE POLICY ponto_extra_punch_rls ON ponto_extra_punch FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ponto_extra_shift, ponto_extra_punch TO yugo_app;

COMMIT;
