-- ==============================================================================
-- 038_lens_orders.sql
-- Pedidos de lente da otica + lotes pro laboratorio.
--
--   lab_batches  — lote que a funcionaria leva ao laboratorio (varios pedidos
--                  agrupados); codigo YYYYMMDD-NN; conferencia na volta.
--   lens_orders  — pedido de lente com medidas (OD/OE), anexo do exame,
--                  vinculo medico/lab e fluxo de status.
--                  status: medido -> solicitado -> chegou -> avisado -> entregue
-- ==============================================================================

CREATE TABLE IF NOT EXISTS lab_batches (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id           uuid REFERENCES stores(id) ON DELETE SET NULL,
  lab_supplier_id    uuid REFERENCES suppliers(id) ON DELETE SET NULL,

  code               text NOT NULL,              -- YYYYMMDD-NN
  status             text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','recebido_parcial','recebido')),
  courier_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,  -- quem leva/busca
  sent_at            timestamptz,
  received_at        timestamptz,
  notes              text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS lab_batches_org_idx ON lab_batches (organization_id, status);

DROP TRIGGER IF EXISTS tg_lab_batches_updated_at ON lab_batches;
CREATE TRIGGER tg_lab_batches_updated_at BEFORE UPDATE ON lab_batches
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE lab_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_batches_rls ON lab_batches;
CREATE POLICY lab_batches_rls ON lab_batches FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lens_orders (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id           uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL,
  sale_id            uuid REFERENCES sales(id) ON DELETE SET NULL,   -- null = avulso
  doctor_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  lab_supplier_id    uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  lab_batch_id       uuid REFERENCES lab_batches(id) ON DELETE SET NULL,

  -- medidas OD/OE, tipo de lente, tratamentos, armacao
  prescription       jsonb NOT NULL DEFAULT '{}'::jsonb,
  exam_attachment_url text,

  status             text NOT NULL DEFAULT 'medido'
                     CHECK (status IN ('medido','solicitado','chegou','avisado','entregue')),
  late               boolean NOT NULL DEFAULT false,
  expected_at        timestamptz,                 -- novo prazo se atrasou

  customer_price_cents bigint,                    -- cobrado do cliente
  lab_cost_cents       bigint,                    -- custo pago ao laboratorio

  notes              text,
  seller_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,   -- comissao (depois)
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  measured_at        timestamptz DEFAULT now(),
  requested_at       timestamptz,
  arrived_at         timestamptz,
  notified_at        timestamptz,
  delivered_at       timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lens_orders_org_idx    ON lens_orders (organization_id, status);
CREATE INDEX IF NOT EXISTS lens_orders_batch_idx  ON lens_orders (lab_batch_id);
CREATE INDEX IF NOT EXISTS lens_orders_cust_idx   ON lens_orders (customer_id);

DROP TRIGGER IF EXISTS tg_lens_orders_updated_at ON lens_orders;
CREATE TRIGGER tg_lens_orders_updated_at BEFORE UPDATE ON lens_orders
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE lens_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lens_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lens_orders_rls ON lens_orders;
CREATE POLICY lens_orders_rls ON lens_orders FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE lens_orders IS
  'Pedidos de lente (medidas OD/OE, anexo do exame, fluxo medido->entregue, lote do lab).';
COMMENT ON TABLE lab_batches IS
  'Lotes enviados ao laboratorio (codigo YYYYMMDD-NN, conferencia na volta).';
