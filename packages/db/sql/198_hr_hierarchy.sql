-- 198_hr_hierarchy.sql
-- Portado de yugo-ponto (183_hr_hierarchy.sql) — renumerado pra sequência do Norty Vision.
-- ==============================================================================
-- 183_hr_hierarchy.sql  (idempotente)  —  Hierarquia de equipe (líder direto)
--
-- Cada funcionário pode ter um LÍDER direto (outro funcionário). Quem está acima
-- na cadeia (líder → líder do líder → … → RH) ajusta o ponto sem pedir permissão;
-- quem está abaixo/ao lado solicita. A regra de permissão é aplicada quando o
-- líder tiver login próprio (fase do painel do líder). Aqui só o vínculo.
-- ==============================================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_employees_leader ON employees (organization_id, leader_id);
