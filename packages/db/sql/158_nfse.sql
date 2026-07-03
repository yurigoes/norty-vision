-- ==============================================================================
-- 158_nfse.sql  (idempotente)  —  FISCAL: NFS-e (Sistema Nacional / Sefin Nacional)
--
-- Estende fiscal_config com os campos da NFS-e (DPS) e fiscal_document p/ guardar
-- a DPS/NFS-e (modelo '99'). Reaproveita o A1 (a1_cert_key/a1_pass_enc) já usado
-- na NFC-e/NF-e. A API nacional é REST + mTLS (certificado na conexão).
-- ==============================================================================

ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS nfse_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfse_municipio     text,
  ADD COLUMN IF NOT EXISTS nfse_serie         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfse_next          integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfse_url_hom        text,
  ADD COLUMN IF NOT EXISTS nfse_url_prod       text,
  ADD COLUMN IF NOT EXISTS nfse_op_simp_nac   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nfse_reg_esp_trib  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nfse_cod_servico   text,
  ADD COLUMN IF NOT EXISTS nfse_cnae          text,
  ADD COLUMN IF NOT EXISTS nfse_aliq_iss      double precision;

ALTER TABLE fiscal_document
  ADD COLUMN IF NOT EXISTS n_dps        integer,
  ADD COLUMN IF NOT EXISTS competencia  date,
  ADD COLUMN IF NOT EXISTS nfse_xml_key text;
