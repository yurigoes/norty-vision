-- ==============================================================================
-- 126_ponto_afd.sql  (idempotente)  —  AFD: campos p/ cabeçalho (1), empregador (2)
-- e empregado (5).
--
-- Registros 1/2/5 do AFD (Portaria 671) carregam dados do empregador, do
-- desenvolvedor (PTRP = yugochat) e o NSR próprio de cada empregador/empregado
-- (mesma sequência das marcações). Aqui adicionamos só as colunas que faltavam.
-- ==============================================================================

ALTER TABLE ponto_config
  ADD COLUMN IF NOT EXISTS employer_nsr         bigint,        -- NSR do registro tipo 2 (empregador)
  ADD COLUMN IF NOT EXISTS employer_recorded_at timestamptz,   -- data/hora de gravação do tipo 2
  ADD COLUMN IF NOT EXISTS local_prestacao      text,          -- tipo 2, campo 9 (local de prestação)
  ADD COLUMN IF NOT EXISTS responsavel_cpf      text,          -- CPF do responsável pelas inclusões/alterações
  ADD COLUMN IF NOT EXISTS dev_tp_idt           smallint NOT NULL DEFAULT 1,  -- 1=CNPJ 2=CPF do desenvolvedor (PTRP)
  ADD COLUMN IF NOT EXISTS dev_idt              text;          -- CNPJ/CPF do desenvolvedor (yugochat)

ALTER TABLE ponto_employee
  ADD COLUMN IF NOT EXISTS nsr              bigint,        -- NSR do registro tipo 5 (inclusão do empregado)
  ADD COLUMN IF NOT EXISTS afd_recorded_at  timestamptz;   -- data/hora de gravação do tipo 5
