-- 196_ponto_holiday_kind.sql
-- Dias especiais pra empresa/loja toda: feriado JÁ existia; aqui adicionamos o
-- TIPO (kind) pra distinguir "feriado" de "ponto facultativo". Ambos viram dia
-- abonado no espelho (esperado = 0, não é falta, não desconta).
--
-- A folga premium / facultativo POR PESSOA é lançada como justificativa aprovada
-- (PontoJustification kind facultativo|folga_premium|feriado), tratada como
-- abonada no espelho — não precisa de tabela nova.

ALTER TABLE ponto_holiday
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'feriado';   -- feriado | facultativo
