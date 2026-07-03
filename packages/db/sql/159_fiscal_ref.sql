-- ==============================================================================
-- 159_fiscal_ref.sql  (idempotente)  —  FISCAL: tabelas de referência (NCM/CEST/LC116)
--
-- Dados OFICIAIS e GLOBAIS (iguais p/ todas as empresas): NCM (Siscomex), CEST×NCM
-- (Convênio ICMS 142/18) e lista de serviços da LC 116/03 (NFS-e). Usadas pra
-- auto-preencher os dados fiscais do produto e reduzir erro. Leitura liberada a
-- todos; escrita só master (importação).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ncm (
  codigo      text PRIMARY KEY,          -- dígitos sem ponto (2/4/6/8)
  descricao   text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ncm_desc ON ncm USING gin (to_tsvector('portuguese', descricao));

CREATE TABLE IF NOT EXISTS cest (
  id          uuid PRIMARY KEY DEFAULT app.new_id(),
  cest        text NOT NULL,             -- dígitos (7)
  ncm         text,                      -- dígitos (pode ser prefixo 2/4/6/8)
  descricao   text,
  UNIQUE (cest, ncm)
);
CREATE INDEX IF NOT EXISTS ix_cest_ncm ON cest (ncm);

CREATE TABLE IF NOT EXISTS servico_lc116 (
  codigo      text PRIMARY KEY,          -- ex.: "1.01"
  descricao   text NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lc116_desc ON servico_lc116 USING gin (to_tsvector('portuguese', descricao));

-- RLS: leitura pública (referência), escrita só master.
DO $$ BEGIN
  EXECUTE 'ALTER TABLE ncm ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE cest ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE servico_lc116 ENABLE ROW LEVEL SECURITY';
END $$;
DROP POLICY IF EXISTS ncm_read ON ncm;          CREATE POLICY ncm_read ON ncm FOR SELECT USING (true);
DROP POLICY IF EXISTS ncm_write ON ncm;         CREATE POLICY ncm_write ON ncm FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS cest_read ON cest;        CREATE POLICY cest_read ON cest FOR SELECT USING (true);
DROP POLICY IF EXISTS cest_write ON cest;       CREATE POLICY cest_write ON cest FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
DROP POLICY IF EXISTS lc116_read ON servico_lc116;  CREATE POLICY lc116_read ON servico_lc116 FOR SELECT USING (true);
DROP POLICY IF EXISTS lc116_write ON servico_lc116; CREATE POLICY lc116_write ON servico_lc116 FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
