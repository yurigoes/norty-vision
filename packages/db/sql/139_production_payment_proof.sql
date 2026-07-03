-- ==============================================================================
-- 139_production_payment_proof.sql  (idempotente)
-- Gráfica/uniformes: comprovante de pagamento (Pix) enviado pelo cliente no WhatsApp
-- após aprovar a arte. Guarda o link do comprovante e a data; a baixa do pagamento
-- continua manual (equipe confere). O arquivo também entra em production_order_files
-- com kind='payment_proof' pro histórico.
-- ==============================================================================
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_proof_at  timestamptz;
