-- ==============================================================================
-- 177_voip_callcenter.sql  (idempotente)  —  Call center multiempresa
-- Cada org pode ter seus próprios trunks SIP (várias linhas), DIDs (vários
-- números), grupos de ramais (estratégia de toque) e URAs (digite 1/2/3...).
-- O FreeSWITCH (único, na VPS externa) atende TODAS as empresas — config
-- dinâmica via mod_xml_curl → /api/voip/fs/xml (configuration/dialplan).
-- ==============================================================================

-- Trunks SIP (linhas) por empresa. A senha SIP fica CIFRADA (AES-256-GCM com
-- chave em env VOIP_TRUNK_KEY); o app nunca devolve plain.
CREATE TABLE IF NOT EXISTS voip_trunk (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,                          -- ex.: "sobreip Salvador"
  sip_host        text NOT NULL,                          -- ex.: voz.sobreip.com.br
  sip_user        text NOT NULL,                          -- usuário SIP / DID principal
  sip_pass_enc    text NOT NULL,                          -- senha cifrada
  register        boolean NOT NULL DEFAULT true,          -- precisa registrar?
  active          boolean NOT NULL DEFAULT true,
  caller_id_name  text,                                   -- nome opcional na bina (CID)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voip_trunk_org ON voip_trunk (organization_id);
ALTER TABLE voip_trunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_trunk FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_trunk_rls ON voip_trunk;
CREATE POLICY voip_trunk_rls ON voip_trunk FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- DIDs (números). Cada número aponta pra um "fluxo de entrada" (group|ivr|extension).
CREATE TABLE IF NOT EXISTS voip_did (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trunk_id        uuid NOT NULL REFERENCES voip_trunk(id) ON DELETE CASCADE,
  number          text NOT NULL,                          -- ex.: 7131800845
  label           text,                                   -- nome do número ("Vendas BA")
  inbound_kind    text NOT NULL DEFAULT 'group',          -- group|ivr|extension
  inbound_id      uuid,                                   -- id do group/ivr/extension
  hours_json      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- regras de horário (opcional)
  fallback_kind   text,                                   -- fora do horário: group|ivr|extension|voicemail
  fallback_id     uuid,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_did_number ON voip_did (number) WHERE active;
CREATE INDEX IF NOT EXISTS ix_voip_did_org ON voip_did (organization_id);
ALTER TABLE voip_did ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_did FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_did_rls ON voip_did;
CREATE POLICY voip_did_rls ON voip_did FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Grupos de ramal (estratégias de toque)
CREATE TABLE IF NOT EXISTS voip_group (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  strategy        text NOT NULL DEFAULT 'all',            -- all|sequential|longest_idle
  ring_timeout_s  int  NOT NULL DEFAULT 25,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voip_group_org ON voip_group (organization_id);
ALTER TABLE voip_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_group FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_group_rls ON voip_group;
CREATE POLICY voip_group_rls ON voip_group FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- Operadores em cada grupo (ramal de cada operador via voip_extension.membership_id).
CREATE TABLE IF NOT EXISTS voip_group_member (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES voip_group(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL,                          -- a quem pertence o ramal
  priority        int  NOT NULL DEFAULT 0,                -- p/ strategy=sequential
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_gmember ON voip_group_member (group_id, membership_id);
CREATE INDEX IF NOT EXISTS ix_voip_gmember_org ON voip_group_member (organization_id);
ALTER TABLE voip_group_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_group_member FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_gmember_rls ON voip_group_member;
CREATE POLICY voip_gmember_rls ON voip_group_member FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- URA / IVR ("digite 1 pra atendimento...")
CREATE TABLE IF NOT EXISTS voip_ivr (
  id                uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  prompt_text       text,                                 -- texto pra TTS (Piper PT-BR)
  prompt_audio_key  text,                                 -- chave no MinIO (.wav pré-gerado)
  digits_timeout_s  int  NOT NULL DEFAULT 5,              -- aguarda dígito quantos seg
  inter_digit_ms    int  NOT NULL DEFAULT 1000,           -- entre dígitos
  max_digits        int  NOT NULL DEFAULT 1,              -- normalmente 1 (1..9)
  max_attempts      int  NOT NULL DEFAULT 3,
  invalid_target_kind text,                               -- pra onde vai se errar (group|ivr|extension|voicemail)
  invalid_target_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voip_ivr_org ON voip_ivr (organization_id);
ALTER TABLE voip_ivr ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_ivr FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_ivr_rls ON voip_ivr;
CREATE POLICY voip_ivr_rls ON voip_ivr FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

CREATE TABLE IF NOT EXISTS voip_ivr_option (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ivr_id          uuid NOT NULL REFERENCES voip_ivr(id) ON DELETE CASCADE,
  digit           text NOT NULL,                          -- "1".."9", "0", "*", "#"
  label           text NOT NULL,                          -- "Atendimento", "Financeiro"
  target_kind     text NOT NULL,                          -- group|ivr|extension|voicemail
  target_id       uuid,                                   -- id do target
  ord             int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voip_ivropt ON voip_ivr_option (ivr_id, digit);
CREATE INDEX IF NOT EXISTS ix_voip_ivropt_org ON voip_ivr_option (organization_id);
ALTER TABLE voip_ivr_option ENABLE ROW LEVEL SECURITY;
ALTER TABLE voip_ivr_option FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voip_ivropt_rls ON voip_ivr_option;
CREATE POLICY voip_ivropt_rls ON voip_ivr_option FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
