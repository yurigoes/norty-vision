-- ==============================================================================
-- 137_fiscal_nfe55.sql  (idempotente)  —  FISCAL: NF-e modelo 55 (B2B / com destinatário)
--
-- A NF-e (55) tem numeração e série PRÓPRIAS (independentes da NFC-e 65) e usa
-- webservices diferentes da NFC-e. Aqui só guardamos série/próximo-número e o
-- override opcional da URL do autorizador NF-e por empresa (mesma ideia do 136).
-- O destinatário é informado na emissão (pré-preenchido pelo cliente da venda).
-- ==============================================================================
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS nfe_serie     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfe_next      integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfe_url_hom   text,
  ADD COLUMN IF NOT EXISTS nfe_url_prod  text;
