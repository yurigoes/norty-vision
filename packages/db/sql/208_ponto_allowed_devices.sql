-- 208_ponto_allowed_devices.sql
-- Portado de yugo-ponto (222_employee_allowed_devices.sql) — renumerado pra sequência do Norty Vision.
-- 222: terminais liberados por funcionário (whitelist).
-- [] (vazio) = sem restrição (pode bater em qualquer terminal autorizado).
-- com IDs = só pode bater nos terminais listados (da própria empresa).
ALTER TABLE ponto_employee ADD COLUMN IF NOT EXISTS allowed_device_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
