-- 186_ponto_punch_voided.sql
-- Adiciona estado de anulação na batida (não deleta — Portaria 671 / hash-chain).
-- Quando o RH "substitui" as batidas de um dia, as antigas viram voided=true
-- (ficam guardadas pra auditoria) e novas são criadas em sequência (sem duplicar
-- no espelho). Espelho/AEJ devem filtrar voided=false.

ALTER TABLE ponto_punch
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamp,
  ADD COLUMN IF NOT EXISTS voided_by uuid;

CREATE INDEX IF NOT EXISTS ponto_punch_voided_idx ON ponto_punch (employee_id, punched_at) WHERE voided = false;
