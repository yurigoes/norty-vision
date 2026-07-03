-- 191_production_features.sql
-- Fase 2 — Sub-módulos da Produção.
-- Granularidade DENTRO do módulo `producao`: cada empresa pode ter abas/telas
-- escondidas (Kanban, Lotes, Tabelas, Costureiras, Importar, NF, Cancelamentos,
-- Financeiro). Controle é do MASTER, no painel da empresa.
--
-- Armazenamento: um JSON de overrides em call_center_settings (onde já moram os
-- toggles de produção estampa/embalagem). Forma: { "<submodulo>": false, ... }.
-- AUSÊNCIA de uma chave = LIGADO (default-on) → nada some por engano ao criar
-- empresa nova ou adicionar um sub-módulo novo no catálogo. Só entram aqui as
-- chaves que o master DESLIGOU explicitamente.

ALTER TABLE call_center_settings
  ADD COLUMN IF NOT EXISTS production_features jsonb;
