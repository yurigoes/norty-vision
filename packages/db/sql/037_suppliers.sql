-- ==============================================================================
-- 037_suppliers.sql
-- Fornecedores da otica: medicos (recebem por exame) e laboratorios (custo da
-- lente). Base pro repasse, pedidos de lente e portal do fornecedor.
--
--   payout_mode = como o medico recebe: 'fixed' (valor por exame) ou
--                 'percent' (% do valor do exame).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  type               text NOT NULL CHECK (type IN ('medico','laboratorio','outro')),
  name               text NOT NULL,
  document           text,                 -- CPF/CNPJ (digitos)
  council_number     text,                 -- CRM (medico)
  phone              text,
  email              text,

  -- regra de repasse (medico)
  payout_mode        text NOT NULL DEFAULT 'fixed' CHECK (payout_mode IN ('fixed','percent')),
  payout_fixed_cents bigint,               -- se 'fixed'
  payout_percent     numeric(5,2),         -- se 'percent'

  -- recebimento
  pix_key            text,
  bank_info          jsonb NOT NULL DEFAULT '{}'::jsonb,

  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),

  -- portal do fornecedor (definido depois; login telefone/CPF + 2FA)
  password_hash      text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE INDEX IF NOT EXISTS suppliers_org_idx ON suppliers (organization_id, type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS suppliers_doc_idx ON suppliers (organization_id, document) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_suppliers_updated_at ON suppliers;
CREATE TRIGGER tg_suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_rls ON suppliers;
CREATE POLICY suppliers_rls ON suppliers FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE suppliers IS
  'Fornecedores da otica: medicos (repasse por exame) e laboratorios (custo da lente).';
