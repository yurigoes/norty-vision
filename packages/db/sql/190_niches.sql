-- 190_niches.sql
-- Tabela de NICHOS editável pelo master. Cada nicho (ótica, gráfica, joalheria…)
-- define quais módulos NÃO aparecem pra empresas dele (deny-list).
--
-- Por que deny-list e não allow-list: módulo novo aparece pra todos os nichos
-- por padrão (não some por engano); o master só ESCONDE o que não se aplica.
-- hidden_module_keys = [] → o nicho vê todos os módulos.
--
-- Substitui a regra que estava chumbada no código (MODULE_NICHES no front).
-- O front passa a ler a deny-list do nicho da empresa via /organizations/me.

CREATE TABLE IF NOT EXISTS niches (
  id                 uuid PRIMARY KEY DEFAULT app.new_id(),
  key                text NOT NULL UNIQUE,        -- slug: "otica", "grafica", "joalheria"
  label              text NOT NULL,
  hidden_module_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  display_order      integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Seed dos nichos atuais preservando EXATAMENTE o comportamento de hoje:
--  - ótica vê tudo
--  - gráfica e genérico NÃO veem os módulos exclusivos de ótica
--    (fornecedores, pedidos_lente, repasses, bi)
INSERT INTO niches (key, label, hidden_module_keys, display_order) VALUES
  ('otica',    'Ótica',             '[]'::jsonb, 1),
  ('grafica',  'Gráfica/Uniformes', '["fornecedores","pedidos_lente","repasses","bi"]'::jsonb, 2),
  ('generico', 'Genérico',          '["fornecedores","pedidos_lente","repasses","bi"]'::jsonb, 3)
ON CONFLICT (key) DO NOTHING;
