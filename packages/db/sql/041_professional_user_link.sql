-- ==============================================================================
-- 041_professional_user_link.sql
-- Vincula profissional (agenda) a um usuario do sistema. Permite replicar:
-- criar profissional cria/associa o usuario, e vice-versa.
-- ==============================================================================

ALTER TABLE professionals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS professionals_user_idx ON professionals (user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN professionals.user_id IS
  'Usuario vinculado ao profissional (login no sistema). Replicacao agenda<->usuarios.';
