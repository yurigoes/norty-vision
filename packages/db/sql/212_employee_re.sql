-- 212_employee_re.sql
-- Portado de yugo-ponto (187_employee_re.sql).
-- ==============================================================================
-- 187_employee_re.sql  (idempotente)  —  RE (Registro de Empregado) por funcionário
--
-- Número de registro do empregado (eSocial), lançado manualmente pelo RH.
-- Aparece no campo "Código" do recibo de pagamento (holerite).
-- ==============================================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS re text;
