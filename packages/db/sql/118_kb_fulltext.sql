-- ==============================================================================
-- 118_kb_fulltext.sql  (idempotente)
--
-- Ecossistema de IA — Fase 2 (recuperação segura, sem infra nova):
-- busca full-text NATIVA do Postgres sobre a base de conhecimento da empresa.
-- O bot passa a puxar as respostas MAIS RELEVANTES à pergunta (RAG-lite), em vez
-- de despejar as primeiras. Sem extensão (pgvector) e sem API externa de
-- embeddings — o dado continua sendo o próprio kb_entries (fonte única, já no
-- backup). Estrutura pronta pra somar embeddings depois (híbrido).
-- ==============================================================================

ALTER TABLE kb_entries
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('portuguese',
      coalesce(question, '') || ' ' || coalesce(answer, '') || ' ' || coalesce(topic, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS kb_entries_search_idx ON kb_entries USING GIN (search_tsv);
