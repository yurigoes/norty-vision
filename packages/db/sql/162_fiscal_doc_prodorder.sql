-- ==============================================================================
-- 162_fiscal_doc_prodorder.sql  (idempotente)  —  vincula NFS-e ao pedido de produção
-- Permite gerar a NFS-e direto do pedido de produção (gráfica) e listar/baixar por pedido.
-- ==============================================================================

ALTER TABLE fiscal_document ADD COLUMN IF NOT EXISTS production_order_id uuid;
CREATE INDEX IF NOT EXISTS ix_fiscal_document_prodorder ON fiscal_document (production_order_id);
