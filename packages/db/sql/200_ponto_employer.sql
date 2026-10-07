-- 200_ponto_employer.sql
-- Portado de yugo-ponto (194_ponto_employer.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 194_ponto_employer.sql  (idempotente)  —  Multi-empregador (multi-CNPJ) Fase 1
--
-- Uma conta pode ter VÁRIOS empregadores (CNPJs) que batem ponto na mesma matriz
-- (ex.: terceirizadas A, B, C). Cada empregador é uma entidade legal própria —
-- nas fases seguintes ganha sua sequência de NSR, hash-chain, AFD/AEJ e A1.
-- Aqui criamos o MODELO e migramos o empregador "default" a partir do ponto_config
-- (não muda nada do funcionamento atual: tudo continua no empregador default).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_employer (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,                       -- razão social / nome
  tp_idt_empregador smallint NOT NULL DEFAULT 1,          -- 1=CNPJ | 2=CPF | 3=CAEPF
  idt_empregador    text,                                 -- CNPJ/CPF
  caepf             text,
  cnae              text,
  tp_rep            smallint NOT NULL DEFAULT 3,           -- 2=REP-A | 3=REP-P
  last_nsr          bigint NOT NULL DEFAULT 0,             -- sequência própria (Fase 2)
  active            boolean NOT NULL DEFAULT true,
  is_default        boolean NOT NULL DEFAULT false,        -- empregador herdado do ponto_config
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ponto_employer_org ON ponto_employer (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ponto_employer_default ON ponto_employer (organization_id) WHERE is_default;

ALTER TABLE ponto_employee ADD COLUMN IF NOT EXISTS employer_id uuid REFERENCES ponto_employer(id) ON DELETE SET NULL;
ALTER TABLE employees      ADD COLUMN IF NOT EXISTS employer_id uuid REFERENCES ponto_employer(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_ponto_employee_employer ON ponto_employee (employer_id);
CREATE INDEX IF NOT EXISTS ix_employees_employer      ON employees (employer_id);

-- RLS
ALTER TABLE ponto_employer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_employer_rls ON ponto_employer;
CREATE POLICY ponto_employer_rls ON ponto_employer
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ---- seed: empregador default por org (a partir do ponto_config) ----
INSERT INTO ponto_employer (organization_id, name, tp_idt_empregador, idt_empregador, caepf, last_nsr, is_default)
SELECT c.organization_id,
       COALESCE(NULLIF(btrim(c.razao_ou_nome), ''), 'Empregador'),
       COALESCE(c.tp_idt_empregador, 1),
       c.idt_empregador, c.caepf, COALESCE(c.last_nsr, 0), true
FROM ponto_config c
WHERE NOT EXISTS (SELECT 1 FROM ponto_employer e WHERE e.organization_id = c.organization_id AND e.is_default);

-- ---- backfill: tudo que existe vai pro empregador default ----
UPDATE ponto_employee pe
   SET employer_id = (SELECT e.id FROM ponto_employer e WHERE e.organization_id = pe.organization_id AND e.is_default LIMIT 1)
 WHERE pe.employer_id IS NULL;

UPDATE employees em
   SET employer_id = (SELECT e.id FROM ponto_employer e WHERE e.organization_id = em.organization_id AND e.is_default LIMIT 1)
 WHERE em.employer_id IS NULL;
