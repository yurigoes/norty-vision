-- ==============================================================================
-- 128_ponto_pwa.sql  (idempotente)  —  PONTO Fase 2: PWA por dispositivo
--
-- Dispositivo (tablet/celular no balcão da filial) com TOKEN próprio: bate ponto
-- sem login de usuário, validando PIN do funcionário + GPS (geofence da filial) +
-- selfie. Marcação offline guarda o horário do dispositivo e é sincronizada depois.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ponto_device (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  name            text NOT NULL,
  token_hash      text NOT NULL UNIQUE,          -- sha256 do token (token cru só é mostrado 1x)
  geo_lat         double precision,              -- coordenadas da filial (geofence)
  geo_lng         double precision,
  geo_radius_m    integer NOT NULL DEFAULT 150,  -- raio permitido em metros
  require_geo     boolean NOT NULL DEFAULT false,
  require_selfie  boolean NOT NULL DEFAULT false,
  last_seen_at    timestamptz,
  last_seen_ip    text,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ponto_device_org_idx ON ponto_device(organization_id);

ALTER TABLE ponto_device ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_device_rls ON ponto_device;
CREATE POLICY ponto_device_rls ON ponto_device
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
