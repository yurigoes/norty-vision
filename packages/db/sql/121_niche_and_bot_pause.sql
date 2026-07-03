-- ==============================================================================
-- 121_niche_and_bot_pause.sql  (idempotente)
--
-- (1) NICHO por empresa: define o segmento (otica, grafica, generico...) e serve
--     de base pros presets de modulo e pra quebra de aprendizado da IA por nicho.
-- (2) PAUSA da IA por conversa: quando o admin responde o cliente DIRETO no
--     WhatsApp do celular (fora do sistema), pausamos o bot por uma janela pra
--     nao haver conflito de duas respostas. NULL = bot livre.
-- ==============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS niche text;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz;

-- index leve pra filtrar empresas por nicho nos rankings do master
CREATE INDEX IF NOT EXISTS organizations_niche_idx ON organizations (niche);
