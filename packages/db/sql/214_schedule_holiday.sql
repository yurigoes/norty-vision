-- ==============================================================================
-- 214_schedule_holiday.sql  (idempotente)  —  Feriado configurável por escala
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O código do ponto JÁ lê e grava `holiday_policy` e `holiday_pay`: a API em
-- `jornada.service.ts` (upsertSchedule e o cálculo do espelho) e a tela em
-- Escalas. As colunas é que nunca existiram aqui — o porte do ponto trouxe o
-- código do RH mas não esta migration, que no RH é a 185, abaixo do corte 198
-- de onde o porte começou.
--
-- O efeito não era um feriado calculado errado. Era pior: `upsertSchedule`
-- monta um objeto `any` e o entrega ao Prisma, que REJEITA argumento que não
-- conhece — então CRIAR OU EDITAR QUALQUER ESCALA falhava, sempre. E o `as any`
-- no cálculo (`(schedule as any)?.holidayPolicy`) fazia o tsc passar batido.
--
-- holiday_policy: folga (padrão, não trabalha) | trabalha | alterna (1 sim/1 não)
-- holiday_pay:    normal | dobro (CLT) | folga_comp (folga compensatória/banco)
--
-- `holiday_pay` é GUARDADO, não aplicado: nenhum cálculo o usa, aqui nem no RH.
-- É informação pra folha e pra contabilidade decidirem o pagamento do feriado
-- trabalhado. Quem muda o esperado do dia é `holiday_policy`.
--
-- Feriados NACIONAIS são calculados em código (fixos + móveis pela Páscoa) e
-- valem pra todas as empresas; os da empresa continuam em `ponto_holiday`.
-- ==============================================================================

ALTER TABLE ponto_schedule ADD COLUMN IF NOT EXISTS holiday_policy text NOT NULL DEFAULT 'folga';
ALTER TABLE ponto_schedule ADD COLUMN IF NOT EXISTS holiday_pay    text NOT NULL DEFAULT 'normal';
