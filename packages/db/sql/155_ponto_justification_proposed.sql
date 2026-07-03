-- ==============================================================================
-- 155_ponto_justification_proposed.sql  (idempotente)  —  PONTO: horários propostos
--
-- O funcionário que "esqueceu de bater" propõe os horários no portal. Antes isso
-- virava só texto no `reason` e a aprovação não aplicava nada. Agora guardamos os
-- horários estruturados em `proposed` (jsonb) e, ao APROVAR um ajuste (kind='ajuste'),
-- o sistema cria as batidas correspondentes no espelho.
-- ==============================================================================

ALTER TABLE ponto_justification ADD COLUMN IF NOT EXISTS proposed jsonb;
