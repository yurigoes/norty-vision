-- ==============================================================================
-- 060_nlu_fix_digits.sql  (idempotente / à prova de re-execução)
-- A mensagem de agendamento usa: 1 CONFIRMAR · 2 CANCELAR · 3 REAGENDAR.
-- O seed antigo (007) mapeava 2=reschedule e 3=cancel (invertido). Em vez de
-- UPDATE (que colide com a unique quando re-rodado), zeramos os atalhos
-- numéricos GLOBAIS e reinserimos no mapeamento correto.
-- ==============================================================================

DELETE FROM intent_keywords
 WHERE organization_id IS NULL
   AND store_id IS NULL
   AND match_type = 'exact'
   AND keyword IN ('1','2','3')
   AND intent IN ('confirm','cancel','reschedule');

INSERT INTO intent_keywords (intent, keyword, match_type, weight, source) VALUES
  ('confirm',    '1', 'exact', 1.00, 'seed'),
  ('cancel',     '2', 'exact', 1.00, 'seed'),
  ('reschedule', '3', 'exact', 1.00, 'seed')
ON CONFLICT (organization_id, store_id, intent, keyword, match_type) DO NOTHING;
