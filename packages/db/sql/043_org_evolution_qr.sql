-- ==============================================================================
-- 043_org_evolution_qr.sql
-- Guarda o ultimo QR code (base64) da instancia Evolution da empresa, capturado
-- via webhook QRCODE_UPDATED. Algumas versoes da Evolution so entregam o QR por
-- webhook (a resposta HTTP do connect nem sempre traz o base64).
-- ==============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS evolution_qr text;

COMMENT ON COLUMN organizations.evolution_qr IS
  'Ultimo QR code (data:image/png;base64) da instancia WhatsApp. Limpo ao conectar.';
