-- ==============================================================================
-- 023_mfa_password_reset.sql
-- 1) Tabela password_reset_tokens
-- 2) Codigos de recuperacao 2FA (one-time codes em jsonb ja existem em users)
-- 3) Tokens de verificacao OTP via WhatsApp/SMS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PASSWORD_RESET_TOKENS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- target: user normal OU platform_user (exatamente um)
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  platform_user_id  uuid REFERENCES platform_users(id) ON DELETE CASCADE,

  -- token raw soh existe no email; armazenamos sha256
  token_hash      text NOT NULL UNIQUE,

  -- canal de entrega
  channel         text NOT NULL CHECK (channel IN ('email','whatsapp','sms')),
  delivered_to    text NOT NULL,                 -- email ou numero E.164

  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,

  -- ratelimit basic
  request_ip      inet,
  user_agent      text,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK ((user_id IS NOT NULL)::int + (platform_user_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS prt_user_idx
  ON password_reset_tokens (user_id) WHERE used_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prt_platform_user_idx
  ON password_reset_tokens (platform_user_id) WHERE used_at IS NULL AND platform_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prt_expires_idx
  ON password_reset_tokens (expires_at) WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prt_all ON password_reset_tokens;
CREATE POLICY prt_all ON password_reset_tokens
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());
-- usuarios normais nao acessam direto - flux passa por endpoints publicos
-- da api, com app.is_platform_admin setado no contexto de lookup

COMMENT ON TABLE password_reset_tokens IS
  'Tokens one-shot pra reset de senha. token_hash = sha256 do raw token enviado no email/whatsapp.';

-- ------------------------------------------------------------------------------
-- OTP_CODES - codigos numericos curtos pra verificacao via SMS/WhatsApp
-- (alternativa a magic links pra MFA, signup confirmation, password reset)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),

  -- identificador do destinatario (telefone E.164 OU email)
  destination     text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),

  -- proposito do codigo
  purpose         text NOT NULL CHECK (purpose IN (
    'password_reset','mfa_login','signup_verify','phone_verify'
  )),

  -- codigo numerico (6 digitos), armazenado como hash
  code_hash       text NOT NULL,

  -- contexto opcional
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  platform_user_id  uuid REFERENCES platform_users(id) ON DELETE CASCADE,

  -- limits
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,

  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,

  -- metadata
  request_ip      inet,
  user_agent      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_destination_idx
  ON otp_codes (destination, purpose, expires_at DESC) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS otp_expires_idx
  ON otp_codes (expires_at) WHERE used_at IS NULL;

ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otp_all ON otp_codes;
CREATE POLICY otp_all ON otp_codes
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

COMMENT ON TABLE otp_codes IS
  'Codigos numericos 6-digitos hash-armazenados pra 2FA SMS/WhatsApp, password reset, signup verify.';
