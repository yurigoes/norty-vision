-- ==============================================================================
-- 036_message_template_category.sql
-- Tipo/urgencia do modelo de mensagem -> define a cor do branding no email.
--   info     (azul)     — informacao
--   low      (verde)    — nao urgente
--   warning  (laranja)  — urgente / cobranca
--   critical (vermelho) — critico / inadimplente
-- ==============================================================================

ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'info'
  CHECK (category IN ('info', 'low', 'warning', 'critical'));

COMMENT ON COLUMN message_templates.category IS
  'Tipo/urgencia: info(azul) low(verde) warning(laranja) critical(vermelho). Define a cor do email.';
