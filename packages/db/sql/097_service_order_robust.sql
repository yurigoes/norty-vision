-- ==============================================================================
-- 097_service_order_robust.sql  (idempotente)
--
-- Ordens de Serviço mais robustas:
--   urgency           — prioridade (low/normal/high/urgent)
--   ready_notified_at — quando avisamos o cliente que ficou pronta (WhatsApp)
--   rating/rating_comment/rated_at — avaliação do cliente pós-entrega
-- ==============================================================================

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS urgency           text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS ready_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rating            int CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_comment    text,
  ADD COLUMN IF NOT EXISTS rated_at          timestamptz;
