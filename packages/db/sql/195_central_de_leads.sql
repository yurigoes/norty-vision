-- Central de Leads: "product skin" da organização.
-- Marca uma org como produto Central de Leads (casca enxuta: só Canais +
-- Conversas + Leads/Pipeline, marca/cores próprias). NULL = plataforma normal.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS product_skin text;
