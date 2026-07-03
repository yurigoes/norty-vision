-- ==============================================================================
-- 154_grafica_catalog.sql  (idempotente)  —  GRÁFICA: tabela de valores + medidas
--
-- EXCLUSIVO do nicho gráfica/uniformes (organizations.niche='grafica'). Não afeta
-- ótica/genérico. Tabela de VALORES com preço por FAIXA de quantidade (volume) e
-- tabela de MEDIDAS (grades de tamanho). Alimentam o catálogo + a IA do atendimento.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS grafica_price_item (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category         text,
  name             text NOT NULL,
  unit_label       text,                                   -- singular p/ a IA (ex.: "camisa")
  tiers            jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{minQty, priceCents}] asc
  sort_order       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_grafica_price_item_org ON grafica_price_item (organization_id, sort_order);
ALTER TABLE grafica_price_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE grafica_price_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grafica_price_item_rls ON grafica_price_item;
CREATE POLICY grafica_price_item_rls ON grafica_price_item FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS grafica_size_chart (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,                          -- ex.: "Masculina", "Babylook"
  rows             jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{size, comprimento, largura}]
  sort_order       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_grafica_size_chart_org ON grafica_size_chart (organization_id, sort_order);
ALTER TABLE grafica_size_chart ENABLE ROW LEVEL SECURITY;
ALTER TABLE grafica_size_chart FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grafica_size_chart_rls ON grafica_size_chart;
CREATE POLICY grafica_size_chart_rls ON grafica_size_chart FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
