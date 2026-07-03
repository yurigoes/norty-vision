-- ==============================================================================
-- 079_org_vitrine.sql  (idempotente)
--
-- Configuração da VITRINE/landing da empresa (subdomínio slug.<base> → /empresa/[slug]):
--   - frase de efeito (headline) + subtítulo + texto "sobre a loja"
--   - banner promocional flutuante (imagem + link + janela de exibição)
-- ==============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vitrine_headline    text,
  ADD COLUMN IF NOT EXISTS vitrine_subheadline text,
  ADD COLUMN IF NOT EXISTS vitrine_about       text,
  ADD COLUMN IF NOT EXISTS banner_image_url    text,
  ADD COLUMN IF NOT EXISTS banner_link_url     text,
  ADD COLUMN IF NOT EXISTS banner_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_starts_at    timestamptz,
  ADD COLUMN IF NOT EXISTS banner_ends_at      timestamptz;
