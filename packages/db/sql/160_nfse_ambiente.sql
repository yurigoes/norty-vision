-- ==============================================================================
-- 160_nfse_ambiente.sql  (idempotente)  —  NFS-e: ambiente próprio (independe da NFC-e)
--
-- Permite a NFS-e ir pra PRODUÇÃO enquanto a NFC-e segue em homologação.
-- null = usa o ambiente global (fiscal_config.ambiente); 1 = Produção; 2 = Homologação.
-- ==============================================================================

ALTER TABLE fiscal_config ADD COLUMN IF NOT EXISTS nfse_ambiente integer;
