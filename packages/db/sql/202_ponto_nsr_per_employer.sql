-- 202_ponto_nsr_per_employer.sql
-- Portado de yugo-ponto (196_nsr_per_employer.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 196_nsr_per_employer.sql  (idempotente)  —  NSR + hash-chain por empregador
--
-- Fase 2b: a sequência de NSR e a cadeia de hash passam a ser POR EMPREGADOR
-- (cada CNPJ tem a sua, sem gaps) — requisito pra AFD/AEJ legais por empresa.
--
-- Segurança da migração:
--  1) garante um empregador DEFAULT por org (inclusive orgs sem ponto_config);
--  2) backfill de employer_id em employees/ponto_employee/ponto_punch;
--  3) o registro tipo 2 (employer_nsr) do default herda do ponto_config;
--  4) RE-SINCRONIZA last_nsr de cada empregador = MAX(nsr já usado) — evita que o
--     novo contador colida com NSR existentes;
--  5) troca a unicidade do NSR de (org,nsr) -> (empregador,nsr).
-- ==============================================================================

ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS employer_nsr         bigint;
ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS employer_recorded_at timestamptz;

-- 1) default p/ orgs que têm funcionário de ponto mas nenhum empregador default
INSERT INTO ponto_employer (organization_id, name, tp_idt_empregador, idt_empregador, caepf, last_nsr, is_default)
SELECT DISTINCT pe.organization_id,
       COALESCE((SELECT NULLIF(btrim(c.razao_ou_nome), '') FROM ponto_config c WHERE c.organization_id = pe.organization_id), 'Empregador'),
       COALESCE((SELECT c.tp_idt_empregador FROM ponto_config c WHERE c.organization_id = pe.organization_id), 1),
       (SELECT c.idt_empregador FROM ponto_config c WHERE c.organization_id = pe.organization_id),
       (SELECT c.caepf FROM ponto_config c WHERE c.organization_id = pe.organization_id),
       0, true
FROM ponto_employee pe
WHERE NOT EXISTS (SELECT 1 FROM ponto_employer e WHERE e.organization_id = pe.organization_id AND e.is_default);

-- 2) backfill employer_id
UPDATE ponto_employee pe SET employer_id = (SELECT e.id FROM ponto_employer e WHERE e.organization_id = pe.organization_id AND e.is_default LIMIT 1) WHERE pe.employer_id IS NULL;
UPDATE employees em      SET employer_id = (SELECT e.id FROM ponto_employer e WHERE e.organization_id = em.organization_id AND e.is_default LIMIT 1) WHERE em.employer_id IS NULL;
UPDATE ponto_punch p     SET employer_id = e2.employer_id FROM ponto_employee e2 WHERE e2.id = p.employee_id AND p.employer_id IS NULL AND e2.employer_id IS NOT NULL;

-- 3) registro tipo 2 do default herda do ponto_config
UPDATE ponto_employer e
   SET employer_nsr = c.employer_nsr, employer_recorded_at = c.employer_recorded_at
  FROM ponto_config c
 WHERE c.organization_id = e.organization_id AND e.is_default AND e.employer_nsr IS NULL;

-- 4) re-sincroniza o contador por empregador (nunca abaixo do maior NSR já usado)
UPDATE ponto_employer e
   SET last_nsr = GREATEST(
     e.last_nsr,
     COALESCE((SELECT MAX(p.nsr)  FROM ponto_punch    p  WHERE p.employer_id  = e.id), 0),
     COALESCE((SELECT MAX(pe.nsr) FROM ponto_employee pe WHERE pe.employer_id = e.id), 0),
     COALESCE(e.employer_nsr, 0)
   );

-- 5) unicidade do NSR: de (org,nsr) para (empregador,nsr)
DROP INDEX IF EXISTS ponto_punch_org_nsr_uk;
CREATE UNIQUE INDEX IF NOT EXISTS ponto_punch_employer_nsr_uk ON ponto_punch (employer_id, nsr);
