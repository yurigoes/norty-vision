-- ==============================================================================
-- 092_canned_scope.sql  (idempotente)
--
-- Respostas rápidas por escopo:
--   private  → só o operador dono vê/usa
--   shared   → compartilhada com toda a equipe (todos veem)
--   global   → da empresa (todos veem); normalmente criada pelo admin
--
-- Permite shortcuts iguais entre operadores (cada um tem o seu /ola), por isso a
-- unicidade antiga (organization_id, shortcut) é trocada por uma que considera o
-- dono (com COALESCE pra tratar NULL = global/empresa).
-- ==============================================================================

ALTER TABLE canned_responses
  ADD COLUMN IF NOT EXISTS scope               text NOT NULL DEFAULT 'global'
    CHECK (scope IN ('private','shared','global')),
  ADD COLUMN IF NOT EXISTS owner_membership_id uuid;

-- remove a unicidade antiga (nome do constraint gerado pelo Prisma)
ALTER TABLE canned_responses DROP CONSTRAINT IF EXISTS canned_responses_organization_id_shortcut_key;

-- nova unicidade: por dono (NULL vira '' = empresa) + shortcut
CREATE UNIQUE INDEX IF NOT EXISTS ux_canned_org_owner_shortcut
  ON canned_responses (organization_id, coalesce(owner_membership_id::text, ''), shortcut);

CREATE INDEX IF NOT EXISTS ix_canned_owner ON canned_responses (owner_membership_id);
