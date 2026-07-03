-- ==============================================================================
-- 047_fix_checks.sql
-- Ajusta CHECK constraints que bloqueavam fluxos novos:
--   - otp_codes.purpose: faltava 'customer_portal' (login do portal por WhatsApp)
--   - credit_accounts.status: faltava 'pending' (conta criada via aplicação de
--     limite pelo cliente, ainda não aprovada)
-- ==============================================================================

-- otp_codes: libera os propósitos dos portais (cliente e fornecedor)
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN (
    'password_reset','mfa_login','signup_verify','phone_verify',
    'customer_portal','supplier_portal'
  ));

-- credit_accounts: status 'pending' (aplicação de limite cria conta pendente)
ALTER TABLE credit_accounts DROP CONSTRAINT IF EXISTS credit_accounts_status_check;
ALTER TABLE credit_accounts ADD CONSTRAINT credit_accounts_status_check
  CHECK (status IN ('active','blocked','frozen','defaulted','pending'));
