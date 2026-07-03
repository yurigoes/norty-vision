-- ==============================================================================
-- 073_landing_contacts.sql
-- Leads do site institucional (landing): "Quero conhecer / Fale com a gente".
-- O master recebe e acompanha (novo → em contato → fechado/perdido).
-- Inspirado em contatos_institucional do sistema anterior.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS landing_contacts (
  id          uuid PRIMARY KEY DEFAULT app.new_id(),
  name        text NOT NULL,
  email       text NOT NULL,
  phone       text,
  company     text,
  segment     text,                 -- ótica / clínica / outro
  message     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  notes       text,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_contacts_status_idx ON landing_contacts (status, created_at);
CREATE INDEX IF NOT EXISTS landing_contacts_ip_idx ON landing_contacts (ip, created_at);

DROP TRIGGER IF EXISTS tg_landing_contacts_updated_at ON landing_contacts;
CREATE TRIGGER tg_landing_contacts_updated_at BEFORE UPDATE ON landing_contacts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- master only (sem coluna de org); o INSERT público é feito pelo serviço como platform admin.
ALTER TABLE landing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS landing_contacts_rls ON landing_contacts;
CREATE POLICY landing_contacts_rls ON landing_contacts FOR ALL
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

COMMENT ON TABLE landing_contacts IS 'Leads/contatos do site institucional para o master atender.';
