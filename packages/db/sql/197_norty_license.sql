-- 197_norty_license.sql
-- Norty Vision — licenças emitidas pelo Norty (revenda). 1 licença = 1 empresa
-- (tenant). Idempotente por external_ref (id da venda no Norty). Tabela de
-- nível plataforma (acesso só via token estático da API /api/norty/v1), sem RLS.

CREATE TABLE IF NOT EXISTS norty_licenses (
  id                uuid PRIMARY KEY,
  external_ref      text NOT NULL UNIQUE,
  organization_id   uuid,
  license_key       text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | SUSPENDED | CANCELED | PENDING
  plan_key          text,
  cycle             text,                             -- monthly | annual | trial
  access_url        text,
  customer_name     text NOT NULL,
  customer_email    text,
  customer_phone    text,
  customer_document text,
  seller_name       text,
  seller_email      text,
  expires_at        timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS norty_licenses_org_idx ON norty_licenses (organization_id);
