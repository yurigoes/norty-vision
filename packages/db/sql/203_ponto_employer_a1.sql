-- 203_ponto_employer_a1.sql
-- Portado de yugo-ponto (197_employer_a1.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 197_employer_a1.sql  (idempotente)  —  Certificado A1 (e-CNPJ) POR EMPREGADOR
--
-- Fase 3: cada empregador (CNPJ) assina com o SEU próprio certificado A1 — espelho,
-- holerite e AFD do funcionário da empresa B usam o e-CNPJ da empresa B.
-- O empregador DEFAULT herda o certificado que já estava no ponto_config (se houver),
-- pra não perder a assinatura atual.
-- ==============================================================================

ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS a1_cert_key  text;
ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS a1_pass_enc  text;
ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS a1_subject   text;
ALTER TABLE ponto_employer ADD COLUMN IF NOT EXISTS a1_not_after timestamptz;

UPDATE ponto_employer e
   SET a1_cert_key = c.a1_cert_key, a1_pass_enc = c.a1_pass_enc, a1_subject = c.a1_subject, a1_not_after = c.a1_not_after
  FROM ponto_config c
 WHERE c.organization_id = e.organization_id AND e.is_default AND e.a1_cert_key IS NULL AND c.a1_cert_key IS NOT NULL;
