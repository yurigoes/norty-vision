-- ==============================================================================
-- 133_ponto_webhook.sql  (idempotente)  —  PONTO Fase 5: webhooks de eventos
--
-- A empresa pode receber um POST a cada marcação (e outros eventos) numa URL,
-- assinado com HMAC-SHA256 (header x-ponto-signature) usando o segredo configurado.
-- ==============================================================================

ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS webhook_url    text,
  ADD COLUMN IF NOT EXISTS webhook_secret text;
