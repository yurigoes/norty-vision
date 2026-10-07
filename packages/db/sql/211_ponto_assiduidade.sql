-- 211_ponto_assiduidade.sql
-- Portado de yugo-ponto (225_assiduidade.sql) — renumerado pra sequência do Norty Vision.
-- 225: Módulo de Assiduidade (bônus). Configurável por empresa; calcula elegibilidade
-- por mês de referência e guarda a liberação ao portal + a assinatura do recibo.
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_bonus_cents      bigint  NOT NULL DEFAULT 15000;  -- R$ 150,00
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_max_atestado_days integer NOT NULL DEFAULT 2;
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_max_lates        integer NOT NULL DEFAULT 4;
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_block_measure    boolean NOT NULL DEFAULT true;  -- medida disciplinar inelegibiliza
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_block_falta      boolean NOT NULL DEFAULT true;  -- falta injustificada inelegibiliza
ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS assid_proportional     boolean NOT NULL DEFAULT true;  -- admissão/retorno de férias no mês = proporcional

CREATE TABLE IF NOT EXISTS ponto_assiduidade (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ponto_employee_id  uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  ref_month          date NOT NULL,                 -- 1º dia do mês
  eligible           boolean NOT NULL DEFAULT false,
  reason             text,                           -- motivo da (in)elegibilidade
  amount_cents       bigint NOT NULL DEFAULT 0,
  days_worked        integer,
  month_days         integer,
  proportional       boolean NOT NULL DEFAULT false,
  released           boolean NOT NULL DEFAULT false, -- RH disponibilizou no portal
  released_at        timestamptz,
  -- assinatura do recibo pelo colaborador
  content_hash       text,
  signature_image_url text,
  signer_ip          text,
  a1_signed          boolean NOT NULL DEFAULT false,
  a1_subject         text,
  p7s_key            text,
  signed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ponto_employee_id, ref_month)
);
CREATE INDEX IF NOT EXISTS ponto_assiduidade_org_idx ON ponto_assiduidade(organization_id, ref_month);
CREATE INDEX IF NOT EXISTS ponto_assiduidade_emp_idx ON ponto_assiduidade(ponto_employee_id);

ALTER TABLE ponto_assiduidade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_assiduidade_rls ON ponto_assiduidade;
CREATE POLICY ponto_assiduidade_rls ON ponto_assiduidade
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
