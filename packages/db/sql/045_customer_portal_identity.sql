-- ==============================================================================
-- 045_customer_portal_identity.sql
-- Portal do cliente acessivel por QUALQUER cliente (nao so quem tem crediario).
--
-- Antes: identidade do portal = credit_account. Cliente sem conta de crediario
-- nao conseguia logar ("Documento nao encontrado").
--
-- Agora: identidade = customer (por documento). Senha inicial = CPF/CNPJ sem
-- pontuacao, com troca obrigatoria no 1o acesso. A conta de crediario continua
-- existindo e e vinculada opcionalmente a sessao (quando o cliente tem credito).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- customers: credenciais do portal
-- ------------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_password_hash text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_must_reset boolean NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_last_login_at timestamptz;

-- indice por documento normalizado (digits) pra login rapido
CREATE INDEX IF NOT EXISTS customers_doc_digits_idx
  ON customers ((regexp_replace(coalesce(document,''), '[^0-9]', '', 'g')))
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- customer_sessions: passa a referenciar o cliente; credito vira opcional
-- ------------------------------------------------------------------------------
ALTER TABLE customer_sessions ADD COLUMN IF NOT EXISTS customer_id uuid;

DO $$ BEGIN
  ALTER TABLE customer_sessions
    ADD CONSTRAINT customer_sessions_customer_fk
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- credit_account_id agora e opcional (cliente pode nao ter crediario)
ALTER TABLE customer_sessions ALTER COLUMN credit_account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id);
