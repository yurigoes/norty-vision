-- ==============================================================================
-- 063_lens_products_os.sql
-- Pedido de lente: vincular óculos (produto) p/ estoque, vincular a lente
-- (produto) p/ puxar custo/preço, e número de OS manual.
-- products.cost_cents = custo do laboratório (visível só pro admin).
-- ==============================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_cents int;

ALTER TABLE lens_orders ADD COLUMN IF NOT EXISTS frame_product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE lens_orders ADD COLUMN IF NOT EXISTS lens_product_id  uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE lens_orders ADD COLUMN IF NOT EXISTS os_number text;

CREATE INDEX IF NOT EXISTS lens_orders_frame_idx ON lens_orders (frame_product_id) WHERE frame_product_id IS NOT NULL;
