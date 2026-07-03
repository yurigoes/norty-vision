-- ==============================================================================
-- 140_production_saldo_reminder.sql  (idempotente)
-- Gráfica: lembrete recorrente de cobrança do SALDO em aberto (pedidos prontos/
-- entregues ou atrasados que não foram quitados). Guarda quando o último lembrete
-- foi enviado pra respeitar a cadência (ex.: a cada 3 dias) e não spammar.
-- ==============================================================================
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS saldo_reminder_at timestamptz;
