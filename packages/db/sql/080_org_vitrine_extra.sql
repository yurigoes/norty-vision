-- ==============================================================================
-- 080_org_vitrine_extra.sql  (idempotente)
--
-- Mais blocos pra vitrine da empresa: endereço + Google Maps, horário de
-- funcionamento e redes sociais. (O "nível de satisfação" é calculado em tempo
-- real a partir de satisfaction_surveys, não precisa de coluna.)
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vitrine_address  text,
  ADD COLUMN IF NOT EXISTS vitrine_maps_url text,
  ADD COLUMN IF NOT EXISTS vitrine_hours    text,
  ADD COLUMN IF NOT EXISTS social_instagram text,
  ADD COLUMN IF NOT EXISTS social_facebook  text,
  ADD COLUMN IF NOT EXISTS social_whatsapp  text,
  ADD COLUMN IF NOT EXISTS social_website   text;
