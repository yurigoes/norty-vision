-- ==============================================================================
-- 136_fiscal_url_override.sql  (idempotente)
-- Override opcional da URL do autorizador NFC-e (NFeAutorizacao4) por empresa.
-- Se preenchido, tem prioridade sobre o mapa interno por UF — assim qualquer
-- estado/SEFAZ novo funciona só preenchendo no painel, sem mexer no código.
-- ==============================================================================
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS nfce_url_hom  text,
  ADD COLUMN IF NOT EXISTS nfce_url_prod text;
