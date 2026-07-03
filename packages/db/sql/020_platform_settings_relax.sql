-- ==============================================================================
-- 020_platform_settings_relax.sql
-- Relaxa CHECK constraint de company_document_type pra aceitar lowercase
-- (form pode enviar 'CNPJ' ou 'cnpj' por engano; normalizamos no banco).
-- ==============================================================================

-- normaliza valores existentes (caso ja tenha algo errado)
UPDATE platform_settings
   SET company_document_type = lower(company_document_type)
 WHERE company_document_type IS NOT NULL
   AND company_document_type <> lower(company_document_type);

-- dropa constraint antiga
ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_company_document_type_check;

-- recria aceitando lowercase ou NULL; trigger normaliza no insert/update
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_company_document_type_check
  CHECK (company_document_type IS NULL
         OR company_document_type IN ('cnpj','cpf'));

-- trigger pra forcar lowercase
CREATE OR REPLACE FUNCTION app.tg_platform_settings_normalize() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_document_type IS NOT NULL THEN
    NEW.company_document_type := lower(NEW.company_document_type);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_platform_settings_normalize ON platform_settings;
CREATE TRIGGER tg_platform_settings_normalize
  BEFORE INSERT OR UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION app.tg_platform_settings_normalize();
