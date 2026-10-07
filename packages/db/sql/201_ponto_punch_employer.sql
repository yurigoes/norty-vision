-- 201_ponto_punch_employer.sql
-- Portado de yugo-ponto (195_punch_employer.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 195_punch_employer.sql  (idempotente)  —  Atribuição da marcação ao empregador
--
-- Fase 2 (parte 1 — SEGURA): cada batida passa a guardar a QUAL empregador (CNPJ)
-- ela pertence. NÃO muda a sequência de NSR nem a cadeia de hash (o AFD continua
-- igual): isto só dá a base pra relatórios/fechamento POR EMPRESA.
--
-- A parte 2 (NSR + hash-chain + AFD por empregador) é um passo próprio, mais
-- sensível, feito com validação de arquivo-teste oficial.
-- ==============================================================================

ALTER TABLE ponto_punch ADD COLUMN IF NOT EXISTS employer_id uuid REFERENCES ponto_employer(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_ponto_punch_employer ON ponto_punch (employer_id, punched_at);

-- backfill: cada batida herda o empregador do funcionário (ponto_employee)
UPDATE ponto_punch p
   SET employer_id = e.employer_id
  FROM ponto_employee e
 WHERE e.id = p.employee_id AND p.employer_id IS NULL AND e.employer_id IS NOT NULL;
