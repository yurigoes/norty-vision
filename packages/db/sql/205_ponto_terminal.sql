-- 205_ponto_terminal.sql
-- Portado de yugo-ponto (211_ponto_terminal.sql) — renumerado pra sequência do Norty Vision.
-- 211: Terminal de ponto (REP-P) — promove ponto_device a terminal completo.
-- Código único por empresa (fiscalização), CNPJ dono, RustDesk (id+senha cripto),
-- versão do app/heartbeat. E vincula cada batida ao terminal físico (auditoria).
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS code              text;
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS employer_id       uuid;
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS rustdesk_id       text;
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS rustdesk_pass_enc text;
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS app_version       text;
ALTER TABLE ponto_device ADD COLUMN IF NOT EXISTS notes             text;
CREATE UNIQUE INDEX IF NOT EXISTS ponto_device_org_code_uidx ON ponto_device(organization_id, code) WHERE code IS NOT NULL;

ALTER TABLE ponto_punch ADD COLUMN IF NOT EXISTS device_id uuid;
CREATE INDEX IF NOT EXISTS ponto_punch_device_idx ON ponto_punch(device_id);
