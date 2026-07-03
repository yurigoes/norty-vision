-- ==============================================================================
-- 152_ponto_accountant.sql  (idempotente)  —  PONTO: e-mail da contabilidade
--
-- Destino para envio dos espelhos de ponto assinados (lote mensal em PDF) ao
-- escritório de contabilidade.
-- ==============================================================================

ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS accountant_email text;
