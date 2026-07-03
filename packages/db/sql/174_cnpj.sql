-- ==============================================================================
-- 174_cnpj.sql  (idempotente)  —  Base de empresas (CNPJ Dados Abertos da Receita)
-- Referência GLOBAL da plataforma (leitura pública, escrita master), como NCM/CEST.
-- Alimenta o Prospector (busca por CNAE + município). Carregada pelo master a
-- partir dos arquivos públicos da Receita (filtrar por UF p/ manter leve).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cnpj_company (
  cnpj            text PRIMARY KEY,                 -- 14 dígitos
  razao_social    text,
  nome_fantasia   text,
  cnae_principal  text,                             -- 7 dígitos
  uf              text,
  municipio       text,                             -- nome (lower) p/ busca
  bairro          text,
  logradouro      text,
  numero          text,
  cep             text,
  telefone        text,
  email           text,
  situacao        text,                             -- ATIVA, BAIXADA, ...
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cnpj_cnae_mun ON cnpj_company (cnae_principal, municipio);
CREATE INDEX IF NOT EXISTS ix_cnpj_uf_cnae ON cnpj_company (uf, cnae_principal);
CREATE INDEX IF NOT EXISTS ix_cnpj_municipio ON cnpj_company (municipio);

ALTER TABLE cnpj_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_company FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cnpj_read ON cnpj_company;  CREATE POLICY cnpj_read ON cnpj_company FOR SELECT USING (true);
DROP POLICY IF EXISTS cnpj_write ON cnpj_company; CREATE POLICY cnpj_write ON cnpj_company FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
