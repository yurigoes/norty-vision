-- ==============================================================================
-- 138_production_status_notify.sql  (idempotente)
-- Gráfica/uniformes: acompanhamento de pedido pelo cliente. Avisa por WhatsApp/e-mail
-- quando o pedido entra em PRODUÇÃO e quando SAI PARA ENTREGA. Flags de idempotência
-- (mesma ideia de ready_notified_at) pra não reenviar a cada toque no status.
-- ==============================================================================
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS producao_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS entrega_notified_at  timestamptz;
