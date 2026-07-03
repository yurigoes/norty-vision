-- ==============================================================================
-- 084_credit_due_adjust_discount_auth.sql  (idempotente)
--
-- Bloco 2 do crediário:
--  (A) ajuste de data de vencimento da parcela pelo admin/gerente
--      (nova data + tolerância + motivo, registra autor e data) — vira ponto de
--      atenção na ficha do cliente (credit_account_events).
--  (B) desconto de juros em pagamento na loja, autorizado por um admin via código
--      de 4 dígitos enviado no WhatsApp do admin. Registra "aprovado por X".
--      O portal mostra valor original / desconto / total pago.
-- ==============================================================================

-- (A) ajuste de vencimento + (B) desconto manual autorizado, na parcela
ALTER TABLE credit_installments
  ADD COLUMN IF NOT EXISTS due_date_original     date,
  ADD COLUMN IF NOT EXISTS due_adjusted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS due_adjusted_by        uuid,    -- membership do admin
  ADD COLUMN IF NOT EXISTS due_adjust_reason      text,
  ADD COLUMN IF NOT EXISTS due_tolerance_days     int,
  ADD COLUMN IF NOT EXISTS manual_discount_cents  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount_cents  bigint,  -- p/ portal: valor sem desconto
  ADD COLUMN IF NOT EXISTS discount_authorized_by uuid,    -- membership que aprovou
  ADD COLUMN IF NOT EXISTS discount_auth_at        timestamptz;

-- (B) códigos de autorização de 4 dígitos (hash), expiram em minutos.
CREATE TABLE IF NOT EXISTS credit_auth_codes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  installment_id      uuid,
  admin_membership_id uuid NOT NULL,     -- quem autoriza (recebe o código)
  requested_by        uuid,              -- operador que pediu (membership)
  purpose             text NOT NULL,     -- 'interest_discount'
  code_hash           text NOT NULL,
  amount_cents        bigint,            -- valor do desconto solicitado
  meta                jsonb,
  attempts            int  NOT NULL DEFAULT 0,
  used_at             timestamptz,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_auth_codes_lookup
  ON credit_auth_codes (organization_id, installment_id, purpose);
