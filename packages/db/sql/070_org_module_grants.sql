-- ==============================================================================
-- 070_org_module_grants.sql
-- Aditivos à la carte: o master libera módulos FORA do plano pra uma empresa.
-- Inspirado no empresa_modulos_extras do sistema anterior.
--   kind = trial      → vence em expires_at (perde acesso automático)
--          alacarte   → cobrança avulsa; expires_at = prazo p/ pagar; bloqueia se não pagar
--          courtesy   → cortesia, sem expiração, ativo até revogar
-- Os módulos efetivos da empresa = features do plano ∪ grants ativos.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS org_module_grants (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key         text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('trial','alacarte','courtesy')),
  price_cents        int,
  expires_at         timestamptz,
  blocked            boolean NOT NULL DEFAULT false,
  paid               boolean NOT NULL DEFAULT false,
  paid_at            timestamptz,
  notes              text,
  created_by_platform_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module_key)
);

CREATE INDEX IF NOT EXISTS org_module_grants_org_idx ON org_module_grants (organization_id);

DROP TRIGGER IF EXISTS tg_org_module_grants_updated_at ON org_module_grants;
CREATE TRIGGER tg_org_module_grants_updated_at BEFORE UPDATE ON org_module_grants
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE org_module_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_module_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_module_grants_rls ON org_module_grants;
CREATE POLICY org_module_grants_rls ON org_module_grants FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE org_module_grants IS
  'Aditivos à la carte: módulos liberados fora do plano (trial/alacarte/cortesia) pelo master.';
