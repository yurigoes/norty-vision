-- 187_call_center_queue_position.sql
-- Config pro aviso "Você está na fila — posição N" enviado quando o cliente
-- entra numa conversa nova e todos os atendentes estão ocupados. Algumas
-- empresas preferem não mostrar fila (psicologicamente desestimula o cliente);
-- agora dá pra desligar no Atendimento → Configurações.
-- Default true: mantém o comportamento histórico (avisa a posição).

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS queue_position_enabled boolean NOT NULL DEFAULT true;
