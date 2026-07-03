-- ==============================================================================
-- 067_hr_geofence_expense.sql
-- RH 2ª leva:
--   - geocerca por loja: lat/lng + raio. Ponto fora do raio é sinalizado.
--   - time_entries: out_of_range + distance_m (distância da loja na batida).
--   - hr_requests: novo tipo 'expense' (reembolso de despesas).
-- ==============================================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS geo_lat double precision;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS geo_lng double precision;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS geo_radius_m int;  -- null = sem geocerca

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS out_of_range boolean NOT NULL DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS distance_m double precision;

-- amplia os tipos de solicitação pra incluir reembolso de despesas
ALTER TABLE hr_requests DROP CONSTRAINT IF EXISTS hr_requests_kind_check;
ALTER TABLE hr_requests ADD CONSTRAINT hr_requests_kind_check
  CHECK (kind IN ('vacation','advance','shift_swap','absence_justify','expense'));

COMMENT ON COLUMN stores.geo_radius_m IS 'Raio (m) da geocerca do ponto. NULL = sem geocerca.';
COMMENT ON COLUMN time_entries.out_of_range IS 'Batida registrada fora do raio da loja (geocerca).';
