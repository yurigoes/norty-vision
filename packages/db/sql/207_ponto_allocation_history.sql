-- 207_ponto_allocation_history.sql
-- Portado de yugo-ponto (221_allocation_borrower_history.sql) — renumerado pra sequência do Norty Vision.
-- 221: a tomadora precisa enxergar alocações ENCERRADAS (para conferir/faturar
-- períodos já fechados). Relaxa a policy de leitura: vê ativas + encerradas
-- destinadas a ela (esconde só as canceladas, que nunca vigoraram).
DROP POLICY IF EXISTS ponto_allocation_borrower_read ON ponto_allocation;
CREATE POLICY ponto_allocation_borrower_read ON ponto_allocation
  FOR SELECT
  USING (
    borrower_org_id = app.current_org_id()
    AND status <> 'cancelled'
  );
