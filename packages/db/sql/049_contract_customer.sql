-- ==============================================================================
-- 049_contract_customer.sql
-- Vincula contrato ao cliente (customer_id) pra que QUALQUER contrato ligado a
-- um cliente apareça no portal dele — não só os de crediário.
-- ==============================================================================

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contracts_customer_idx ON contracts (customer_id);

-- backfill: contratos de crediário herdam o cliente titular da conta
UPDATE contracts c
   SET customer_id = ca.primary_customer_id
  FROM credit_accounts ca
 WHERE c.credit_account_id = ca.id
   AND c.customer_id IS NULL
   AND ca.primary_customer_id IS NOT NULL;

-- backfill: contratos avulsos casam pelo documento do signatário
UPDATE contracts c
   SET customer_id = cu.id
  FROM customers cu
 WHERE c.customer_id IS NULL
   AND c.signer_document IS NOT NULL
   AND cu.organization_id = c.organization_id
   AND cu.deleted_at IS NULL
   AND regexp_replace(coalesce(cu.document,''), '[^0-9]', '', 'g') =
       regexp_replace(c.signer_document, '[^0-9]', '', 'g');
