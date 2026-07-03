-- ==============================================================================
-- 082_product_lab.sql  (idempotente)
--
-- Lente (produto) vinculada a um laboratório (Fornecedor tipo lab). Usado pra,
-- ao escolher a lente no pedido, puxar o laboratório automaticamente.
-- Produtos da categoria "lentes" não aparecem na vitrine por padrão (a app
-- aplica show_in_catalog=false no cadastro; aqui só garantimos a coluna FK).
-- ==============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS laboratory_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_lab_idx
  ON products(laboratory_supplier_id) WHERE laboratory_supplier_id IS NOT NULL;
