-- ==============================================================================
-- 033_product_image.sql
-- Imagem opcional do produto (link ou upload no MinIO).
-- ==============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
COMMENT ON COLUMN products.image_url IS 'URL da imagem do produto (upload MinIO ou link externo).';
