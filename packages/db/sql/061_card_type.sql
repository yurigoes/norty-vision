-- ==============================================================================
-- 061_card_type.sql
-- Distinguir cartão de CRÉDITO x DÉBITO no fechamento de caixa.
-- ==============================================================================

ALTER TABLE sale_payments
  ADD COLUMN IF NOT EXISTS card_type text
  CHECK (card_type IS NULL OR card_type IN ('credit','debit'));
