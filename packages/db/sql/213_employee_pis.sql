-- 213_employee_pis.sql
-- Portado de yugo-ponto (203_employee_pis.sql).
-- ==============================================================================
-- 203_employee_pis.sql  (idempotente)  —  PIS/PASEP do funcionário (eSocial/AEJ)
-- ==============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pis text;
