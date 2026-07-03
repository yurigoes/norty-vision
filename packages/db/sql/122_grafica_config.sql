-- ==============================================================================
-- 122_grafica_config.sql  (idempotente)
--
-- Config do nicho GRÁFICA/UNIFORMES por empresa (consumida pelo bot e pela
-- mensagem pós-aprovação de arte): chave Pix, tabela de medidas (texto +
-- arquivo opcional) e prazo padrão de entrega em dias. Fica em
-- call_center_settings (já é por empresa e já é lida pelo bot).
-- ==============================================================================

ALTER TABLE call_center_settings ADD COLUMN IF NOT EXISTS grafica_pix_key        text;
ALTER TABLE call_center_settings ADD COLUMN IF NOT EXISTS grafica_size_chart     text;
ALTER TABLE call_center_settings ADD COLUMN IF NOT EXISTS grafica_size_chart_url text;
ALTER TABLE call_center_settings ADD COLUMN IF NOT EXISTS grafica_lead_days      int NOT NULL DEFAULT 7;
