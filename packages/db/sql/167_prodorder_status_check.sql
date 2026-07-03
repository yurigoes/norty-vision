-- ==============================================================================
-- 167_prodorder_status_check.sql  (idempotente)  —  novos status do pedido
-- Adiciona 'cancelamento_solicitado' (fila de estorno) ao CHECK de status e
-- 'refunded' ao CHECK de payment_status (estorno concluído).
-- ==============================================================================

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
ALTER TABLE production_orders ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('novo','arte','costura','producao','separacao','pronto','entrega','finalizado','cancelado','cancelamento_solicitado'));

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_payment_status_check;
ALTER TABLE production_orders ADD CONSTRAINT production_orders_payment_status_check
  CHECK (payment_status IN ('none','partial','paid','refunded'));
