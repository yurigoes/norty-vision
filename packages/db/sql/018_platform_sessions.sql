-- ==============================================================================
-- 018_platform_sessions.sql
-- Sessoes do master (platform_users). Tabela separada de `sessions` (que e
-- para users normais) por clareza e seguranca: a auth do master e fluxo
-- diferente, com MFA obrigatorio e auditoria reforcada.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS platform_sessions (
  id                  uuid PRIMARY KEY DEFAULT app.new_id(),
  platform_user_id    uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,

  -- token armazenado apenas como hash sha256; raw soh no cookie
  token_hash          text NOT NULL UNIQUE,

  -- escopo: lista de categorias de tech_specs liberadas nesta sessao
  -- (assim master pode ver tudo, mas user com grant ve so o que foi liberado).
  -- Para platform_users sempre ['*'] (todas).
  tech_specs_categories text[] NOT NULL DEFAULT ARRAY['*'],

  -- metadata
  ip_address          inet,
  user_agent          text,

  -- ciclo de vida (mais curto que sessao normal por seguranca)
  expires_at          timestamptz NOT NULL,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoke_reason       text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_sessions_user_active_idx
  ON platform_sessions (platform_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS platform_sessions_expires_idx
  ON platform_sessions (expires_at) WHERE revoked_at IS NULL;

-- RLS: so o proprio master ve suas sessoes
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_sessions_self ON platform_sessions;
CREATE POLICY platform_sessions_self ON platform_sessions
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

COMMENT ON TABLE platform_sessions IS
  'Sessoes do master/super-admin. Isolado do fluxo de users normais.';
