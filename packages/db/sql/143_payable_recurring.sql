-- ==============================================================================
-- 143_payable_recurring.sql  (idempotente)
-- Contas a pagar RECORRENTES (mensais fixas: aluguel, internet, etc).
-- A conta vira um "modelo": um cron gera a parcela de cada mês no dia configurado.
-- ==============================================================================
ALTER TABLE payable
  ADD COLUMN IF NOT EXISTS recurring             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_day        integer,            -- dia do vencimento (1..28)
  ADD COLUMN IF NOT EXISTS recurrence_amount_cents bigint,           -- valor mensal
  ADD COLUMN IF NOT EXISTS recurrence_until      date,               -- até quando gerar (null = indefinido)
  ADD COLUMN IF NOT EXISTS recurrence_last       date;               -- 1º dia do último mês já gerado
