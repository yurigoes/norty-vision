-- ==============================================================================
-- 120_kb_embeddings.sql  (idempotente)
--
-- Ecossistema de IA — Fase 2b: memória SEMÂNTICA por empresa (pgvector).
-- Guarda o embedding de cada resposta da base de conhecimento; a busca passa a
-- ser híbrida (vetor + full-text). Dado fica no Postgres principal (mesmo
-- backup) e isolado por empresa (RLS). Degrada pro full-text se não houver
-- embeddings — nada quebra.
--
-- Dimensão 1024 = bge-m3 (recomendado, roda em CPU). Se trocar pra um modelo
-- de outra dimensão, criar nova migração com a dimensão certa.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS kb_embeddings (
  kb_id            uuid PRIMARY KEY REFERENCES kb_entries(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model            text NOT NULL,
  embedding        vector(1024) NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_embeddings_org_idx ON kb_embeddings (organization_id);
-- índice ANN (cosine) — acelera a busca por similaridade
CREATE INDEX IF NOT EXISTS kb_embeddings_vec_idx ON kb_embeddings USING hnsw (embedding vector_cosine_ops);

ALTER TABLE kb_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_embeddings_rls ON kb_embeddings;
CREATE POLICY kb_embeddings_rls ON kb_embeddings FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
