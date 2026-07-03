-- ==============================================================================
-- 005_catalog.sql
-- Cadastros: customers (pacientes/clientes finais) e professionals (medicos).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- CUSTOMERS - clientes finais (pacientes da otica, compradores, etc)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  -- identidade
  name            text   NOT NULL,
  display_name    text,                                    -- como chamar ("Sr Joao", apelido)
  document        text,                                    -- CPF, normalizado (so digitos)
  document_type   text CHECK (document_type IN ('cpf','cnpj','passport','other')) DEFAULT 'cpf',
  birth_date      date,
  gender          text CHECK (gender IN ('male','female','other','unspecified')) DEFAULT 'unspecified',

  -- contato
  email           citext,
  phone           text,                                    -- E.164 (+5511999998888)
  phone_secondary text,
  whatsapp_phone  text,                                    -- pode diferir do phone

  -- preferencias de canal
  prefers_channel text CHECK (prefers_channel IN ('whatsapp','sms','email','phone','none')) DEFAULT 'whatsapp',
  opt_out_marketing boolean NOT NULL DEFAULT false,
  opt_out_at      timestamptz,

  -- endereco simplificado (relacao detalhada futura via customer_addresses)
  city            text,
  state           text,
  postal_code     text,

  -- tags livres (busca rapida)
  tags            text[] NOT NULL DEFAULT '{}',

  -- metadados livres por loja (sem ferir schema)
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- origem (de onde veio o cadastro)
  source          text,                                    -- 'manual','import','lead','website'

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  -- unicidade por documento dentro da loja (NULL nao colide)
  -- (customer pode estar em varias lojas da mesma org com documento igual? Sim. Cada loja seu cadastro.)
  CONSTRAINT customers_doc_unique_per_store
    EXCLUDE (document WITH =, store_id WITH =) WHERE (document IS NOT NULL AND deleted_at IS NULL)
);

CREATE INDEX IF NOT EXISTS customers_store_idx
  ON customers (store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_phone_idx
  ON customers (store_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_whatsapp_idx
  ON customers (store_id, whatsapp_phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_email_idx
  ON customers (store_id, email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_name_trgm
  ON customers USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_tags_idx
  ON customers USING gin (tags) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_customers_updated_at ON customers;
CREATE TRIGGER tg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE customers IS
  'Cliente final/paciente. Isolado por loja (cada loja tem seu cadastro mesmo se a pessoa for a mesma).';

-- ------------------------------------------------------------------------------
-- PROFESSIONALS - quem presta o servico (medico, atendente, vendedor especialista)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professionals (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  -- ligacao opcional com user (se o profissional faz login no sistema)
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,

  -- identidade
  name            text NOT NULL,
  display_name    text,                                    -- "Dr Joao", "Dra Maria"
  document        text,                                    -- CPF
  registration_id text,                                    -- CRM, CRO, OAB, etc
  registration_uf text,
  specialty       text,
  bio             text,

  -- midia
  avatar_url      text,

  -- contato
  email           citext,
  phone           text,

  -- operacao
  color_hex       text CHECK (color_hex ~ '^#[0-9a-fA-F]{6}$'),  -- cor pra UI
  default_appointment_duration_min int NOT NULL DEFAULT 15,
  default_appointment_capacity     int NOT NULL DEFAULT 1,
  accepts_walk_in boolean NOT NULL DEFAULT false,

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive','vacation','suspended')),

  -- ordem na lista (UI)
  display_order   int NOT NULL DEFAULT 0,

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS professionals_store_idx
  ON professionals (store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS professionals_user_idx
  ON professionals (user_id) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS professionals_status_idx
  ON professionals (store_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS professionals_name_trgm
  ON professionals USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_professionals_updated_at ON professionals;
CREATE TRIGGER tg_professionals_updated_at
  BEFORE UPDATE ON professionals
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE professionals IS
  'Quem atende (medico, atendente, vendedor especialista). user_id opcional - so se ele faz login.';

-- ------------------------------------------------------------------------------
-- CUSTOMER_NOTES - notas livres por atendente (historico de relacionamento)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_notes (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  body            text NOT NULL,
  pinned          boolean NOT NULL DEFAULT false,
  is_private      boolean NOT NULL DEFAULT false,         -- visivel so pra quem escreveu

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_notes_customer_idx
  ON customer_notes (customer_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_customer_notes_updated_at ON customer_notes;
CREATE TRIGGER tg_customer_notes_updated_at
  BEFORE UPDATE ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();
