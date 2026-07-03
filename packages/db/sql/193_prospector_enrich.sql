-- 193_prospector_enrich.sql
-- Fase A.5 — Enriquecimento de CNPJ ao vivo (BrasilAPI).
-- O Prospector já busca no OSM/base CNPJ e joga no funil. Aqui adicionamos o
-- enriquecimento por CNPJ via BrasilAPI (pública/grátis) — sem depender do dump
-- da Receita carregado na cnpj_company: razão social, CNAE, situação (ATIVA/
-- BAIXADA), telefone/email faltantes. BAIXADA é descartada.

ALTER TABLE prospect_campaign
  ADD COLUMN IF NOT EXISTS enrich_cnpj_auto boolean NOT NULL DEFAULT false;

ALTER TABLE prospect_result
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS situacao text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
