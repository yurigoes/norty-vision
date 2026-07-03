-- ==============================================================================
-- 135_fiscal_nfce.sql  (idempotente)  —  FISCAL F0: fundação NFC-e (modelo 65) direto SEFAZ
--
-- Config fiscal do emitente (CNPJ/IE/regime/CSC/série/A1/ambiente + endereço),
-- campos fiscais nos produtos (NCM/CFOP/CEST/origem/unidade/CST/CSOSN) e a tabela
-- de documentos fiscais emitidos. Assinatura usa o A1 (e-CNPJ) — mesma ideia do ponto.
--
-- Começa em AMBIENTE DE HOMOLOGAÇÃO (ambiente=2). Produção (1) só após CSC + validação.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS fiscal_config (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  -- identificação do emitente
  cnpj              text,
  ie                text,                                   -- Inscrição Estadual
  im                text,                                   -- Inscrição Municipal (NFS-e futura)
  razao_social      text,
  nome_fantasia     text,
  crt               smallint NOT NULL DEFAULT 1,            -- 1=Simples, 2=Simples excesso, 3=Regime Normal
  uf                text,                                   -- sigla (SP, RJ...)
  cmun              text,                                   -- código IBGE do município (7 díg)
  municipio         text,
  logradouro        text,
  numero            text,
  complemento       text,
  bairro            text,
  cep               text,
  fone              text,
  -- NFC-e
  ambiente          smallint NOT NULL DEFAULT 2,            -- 1=produção, 2=homologação
  nfce_serie        integer NOT NULL DEFAULT 1,
  nfce_next         integer NOT NULL DEFAULT 1,             -- próximo número sequencial
  csc_id            text,                                   -- idCSC (token NFC-e, ex.: "000001")
  csc_token_enc     text,                                   -- CSC cifrado (AES-256-GCM via COOKIE_SECRET)
  -- certificado A1 (e-CNPJ) — assina o XML
  a1_cert_key       text,                                   -- .pfx no bucket privado
  a1_pass_enc       text,
  a1_subject        text,
  a1_not_after      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fiscal_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_config_rls ON fiscal_config;
CREATE POLICY fiscal_config_rls ON fiscal_config
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Campos fiscais nos produtos (NFC-e exige NCM/CFOP/origem/unidade + CST ou CSOSN)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ncm        text,
  ADD COLUMN IF NOT EXISTS cfop       text,
  ADD COLUMN IF NOT EXISTS cest       text,
  ADD COLUMN IF NOT EXISTS origem     smallint NOT NULL DEFAULT 0,   -- 0=nacional ... 8 (tabela origem)
  ADD COLUMN IF NOT EXISTS unidade    text NOT NULL DEFAULT 'UN',
  ADD COLUMN IF NOT EXISTS cst        text,                          -- regime normal
  ADD COLUMN IF NOT EXISTS csosn      text,                          -- Simples Nacional
  ADD COLUMN IF NOT EXISTS aliq_icms  numeric(5,2);

-- Documentos fiscais emitidos
CREATE TABLE IF NOT EXISTS fiscal_document (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id) ON DELETE SET NULL,
  sale_id           uuid,                                   -- vínculo com a venda do PDV
  modelo            text NOT NULL DEFAULT '65',             -- 65=NFC-e, 55=NF-e
  serie             integer,
  numero            integer,
  chave             text,                                   -- chNFe (44 díg)
  ambiente          smallint NOT NULL DEFAULT 2,
  status            text NOT NULL DEFAULT 'rascunho',       -- rascunho|assinada|autorizada|rejeitada|cancelada|contingencia|erro
  protocolo         text,                                   -- nProt
  motivo            text,                                   -- cStat + xMotivo
  total_cents       integer,
  xml_key           text,                                   -- XML autorizado no bucket privado
  danfe_key         text,                                   -- PDF do DANFCe (opcional)
  qr_url            text,                                   -- URL do QR Code (NFC-e)
  cancel_motivo     text,
  authorized_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscal_document_org_idx ON fiscal_document(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fiscal_document_sale_idx ON fiscal_document(sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_document_chave_uq ON fiscal_document(chave) WHERE chave IS NOT NULL;

ALTER TABLE fiscal_document ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_document_rls ON fiscal_document;
CREATE POLICY fiscal_document_rls ON fiscal_document
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
