-- ==============================================================================
-- 163_kiosk_token.sql  (idempotente)  —  KIOSK: token público p/ painéis de TV
-- Token por empresa pra abrir painéis de visualização (recepção/produção) numa TV,
-- sem login interativo. URL: /k/recepcao/{token}. Rotacionável pelo admin.
-- ==============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kiosk_token text;
CREATE UNIQUE INDEX IF NOT EXISTS ix_org_kiosk_token ON organizations (kiosk_token) WHERE kiosk_token IS NOT NULL;
