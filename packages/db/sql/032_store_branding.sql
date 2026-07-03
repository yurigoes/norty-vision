-- ==============================================================================
-- 032_store_branding.sql
-- Branding por loja: cada loja escolhe cor, logo e modo de tema. Aplicado na
-- UI quando o operador esta logado naquela loja e no portal do cliente.
-- ==============================================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_primary_color   text
  CHECK (theme_primary_color   IS NULL OR theme_primary_color   ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_secondary_color text
  CHECK (theme_secondary_color IS NULL OR theme_secondary_color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_accent_color    text
  CHECK (theme_accent_color    IS NULL OR theme_accent_color    ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS logo_url       text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS logo_dark_url  text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS favicon_url    text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme_mode     text NOT NULL DEFAULT 'system'
  CHECK (theme_mode IN ('light','dark','system'));

COMMENT ON COLUMN stores.theme_primary_color IS
  'Cor predominante da loja (hex). Sobrescreve --brand na UI quando logado nessa loja.';
