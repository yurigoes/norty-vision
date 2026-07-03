-- ==============================================================================
-- 182_macros.sql  (idempotente)
--
-- Macros: sequências de ações que o operador dispara em 1 clique sobre uma
-- conversa do inbox. Estilo Chatwoot. Ações suportadas (no service):
--
--   { kind: "send_message", body: string }
--   { kind: "assign", assigneeMembershipId?: string }
--   { kind: "transfer_team", teamId: string }
--   { kind: "add_label", labelId: string }
--   { kind: "remove_label", labelId: string }
--   { kind: "set_status", status: "open" | "pending" | "resolved" }
--   { kind: "set_priority", priority: string }
--
-- O `actions` é JSON array que o front edita. As variáveis {{cliente.nome}}
-- (mesmas do PR1) são substituídas em send_message.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inbox_macros (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_macros_org_idx ON inbox_macros (organization_id, is_active);

ALTER TABLE inbox_macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_macros FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_macros_tenant ON inbox_macros;
CREATE POLICY inbox_macros_tenant ON inbox_macros
  FOR ALL
  USING (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  )
  WITH CHECK (
    app.is_platform_admin()
    OR organization_id = app.current_org_id()
  );
