-- ==============================================================================
-- 114_subscription_invoice_dunning.sql  (idempotente)
--
-- Cobrança automática das mensalidades: marca quando a empresa foi avisada por
-- último (pra não spammar) na régua de cobrança da assinatura.
-- ==============================================================================

ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS last_dunned_at timestamptz;
