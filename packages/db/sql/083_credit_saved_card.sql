-- ==============================================================================
-- 083_credit_saved_card.sql  (idempotente)
--
-- Cartão salvo p/ cobrança automática do crediário (modelo: cartão salvo no MP +
-- cobrança avulsa de cada parcela no vencimento). NUNCA guardamos o número do
-- cartão — só os ids do Mercado Pago (customer + card) e os 4 últimos/bandeira.
-- ==============================================================================

ALTER TABLE credit_accounts
  ADD COLUMN IF NOT EXISTS mp_customer_id   text,
  ADD COLUMN IF NOT EXISTS mp_card_id       text,
  ADD COLUMN IF NOT EXISTS card_last4       text,
  ADD COLUMN IF NOT EXISTS card_brand       text,
  ADD COLUMN IF NOT EXISTS card_pm_id       text,            -- payment_method_id do MP (ex.: 'visa')
  ADD COLUMN IF NOT EXISTS auto_charge      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS card_saved_at    timestamptz;

-- controle das tentativas automáticas por parcela (3x em 3 dias).
ALTER TABLE credit_installments
  ADD COLUMN IF NOT EXISTS auto_charge_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_charge_last_at  timestamptz,
  ADD COLUMN IF NOT EXISTS auto_charge_status   text;          -- pending|approved|rejected|exhausted
