-- ==============================================================================
-- 180_grafica_max_discount.sql  (idempotente)
--
-- Percentual MÁXIMO de desconto que o operador (vendedor) pode aplicar num
-- pedido de produção SEM precisar de autorização do gerente/admin via código
-- de 4 dígitos. Acima desse %, o sistema continua pedindo autorização (modal
-- já existente).
--
-- 0  = qualquer desconto exige autorização (estado anterior à migration)
-- 5  = vendedor pode aplicar até 5% sozinho; acima disso, exige autorização
-- 100 = sem limite (qualquer desconto é aprovado direto)
-- ==============================================================================

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS grafica_max_operator_discount_pct numeric(5,2) NOT NULL DEFAULT 0;
