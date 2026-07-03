-- ==============================================================================
-- 153_infinitepay_link.sql  (idempotente)  —  PAGAMENTOS: links de checkout InfinitePay
--
-- A InfinitePay (Checkout por link) é identificada só pela `handle` (guardada em
-- organization_integrations.config, provider='infinitepay'). Cada link gerado
-- vira uma linha aqui: o id é o `order_nsu` enviado à InfinitePay; usamos para
-- casar o webhook (sem assinatura) e confirmar via /payment_check antes de
-- liquidar a parcela/venda. Serve a qualquer cobrança (kind: installment|sale).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS infinitepay_link (
  id               uuid PRIMARY KEY DEFAULT app.new_id(),   -- == order_nsu
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL,                           -- installment | sale
  ref_id           uuid NOT NULL,                           -- id da parcela/venda
  amount_cents     bigint NOT NULL,
  link             text,                                    -- URL do checkout
  slug             text,                                    -- invoice_slug da InfinitePay
  transaction_nsu  text,                                    -- preenchido no webhook
  capture_method   text,                                    -- pix | credit_card
  status           text NOT NULL DEFAULT 'pending',         -- pending | paid | failed
  paid_amount_cents bigint,
  receipt_url      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE infinitepay_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE infinitepay_link FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS infinitepay_link_rls ON infinitepay_link;
CREATE POLICY infinitepay_link_rls ON infinitepay_link FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_infinitepay_link_ref ON infinitepay_link (organization_id, kind, ref_id);
