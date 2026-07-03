-- ==============================================================================
-- 123_grafica_down_payment.sql  (idempotente)
--
-- Percentual de ENTRADA padrão do nicho gráfica (ex.: 50% ao abrir o pedido).
-- O form de novo pedido pré-preenche a entrada com esse % do total; o admin
-- ajusta em Atendimento → Config. 0 = não sugere entrada.
-- ==============================================================================

ALTER TABLE call_center_settings ADD COLUMN IF NOT EXISTS grafica_down_payment_pct int NOT NULL DEFAULT 50;
