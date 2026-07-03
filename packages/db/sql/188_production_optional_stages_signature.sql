-- 188_production_optional_stages_signature.sql
-- 1) Estágios opcionais no kanban da produção: "estampa" entre producao e
--    costura; "embalagem" entre pronto e entrega. Cada org liga/desliga
--    independentemente (algumas gráficas têm essas etapas, outras não).
--    Default false (mantém fluxo existente).
-- 2) Assinatura simplificada do cliente na OS (sem certificado — só
--    comprovação visual de retirada/aprovação). Imagem PNG da assinatura +
--    timestamp + IP, anexada ao próprio production_order.

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS production_stamp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_packaging_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS customer_signature_url text,
  ADD COLUMN IF NOT EXISTS customer_signed_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_signature_ip text;
