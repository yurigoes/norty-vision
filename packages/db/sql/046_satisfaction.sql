-- ==============================================================================
-- 046_satisfaction.sql
-- Pesquisa de satisfação (NPS) por etapa + nota do vendedor.
--
-- Gerada ao entregar um pedido de lente (etapa 'entregue'), ao concluir uma
-- venda, ou manualmente. O cliente responde por um link público (token):
--   - NPS 0..10 (recomendaria?)
--   - nota do vendedor 1..5 (opcional)
--   - comentário (opcional)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,

  kind            text NOT NULL CHECK (kind IN ('lens_order','sale','appointment','manual')),
  ref_id          uuid,                       -- id do pedido/venda/agendamento
  stage           text,                       -- etapa (ex.: 'entregue')

  token           text NOT NULL UNIQUE,       -- link público
  seller_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,

  nps_score       int CHECK (nps_score BETWEEN 0 AND 10),
  seller_rating   int CHECK (seller_rating BETWEEN 1 AND 5),
  comment         text,

  channel         text,                       -- canal de envio (whatsapp/email)
  sent_at         timestamptz,
  responded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS satisfaction_org_idx ON satisfaction_surveys (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS satisfaction_seller_idx ON satisfaction_surveys (seller_user_id);

-- RLS: org-scoped pro admin; o acesso público é via service (is_platform_admin)
ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE satisfaction_surveys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS satisfaction_rls ON satisfaction_surveys;
CREATE POLICY satisfaction_rls ON satisfaction_surveys FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
