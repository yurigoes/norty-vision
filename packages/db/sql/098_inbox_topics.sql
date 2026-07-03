-- ==============================================================================
-- 098_inbox_topics.sql  (idempotente)
--
-- "Maiores dúvidas": classifica cada mensagem de entrada do cliente num tópico
-- (preço, horário, agendar, status do pedido, garantia, crediário, etc.) para
-- alimentar o painel de dúvidas mais frequentes e sugerir respostas prontas.
-- ==============================================================================

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS topic text;

CREATE INDEX IF NOT EXISTS conversation_messages_topic_idx
  ON conversation_messages (organization_id, topic, created_at DESC)
  WHERE topic IS NOT NULL;
