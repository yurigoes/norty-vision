-- ==============================================================================
-- 048_lens_order_delivery.sql
-- Pedido de lente: produto/óculos detalhado + foto, nota fiscal (anexo) e
-- comprovante de entrega assinado digitalmente pelo cliente.
-- ==============================================================================

ALTER TABLE lens_orders
  ADD COLUMN IF NOT EXISTS product_description text,
  ADD COLUMN IF NOT EXISTS product_photo_url text,
  ADD COLUMN IF NOT EXISTS nf_number text,
  ADD COLUMN IF NOT EXISTS nf_url text,
  ADD COLUMN IF NOT EXISTS nf_attached_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_signature_url text,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz;
