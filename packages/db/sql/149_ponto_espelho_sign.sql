-- ==============================================================================
-- 149_ponto_espelho_sign.sql  (idempotente)  —  PONTO: Espelho assinado + banco c/ vencimento
--
-- Assinatura do espelho mensal pelo funcionário: guarda o HASH do conteúdo
-- (integridade), a imagem da assinatura, IP e data. Se houver A1 (ICP-Brasil),
-- guarda também o .p7s (assinatura digital). Sem A1 → assinatura eletrônica
-- simples de CONTINGÊNCIA (carimbo + hash SHA-256).
-- Banco de horas: prazo de compensação (vencimento), default 6 meses (CLT).
-- ==============================================================================

ALTER TABLE ponto_config ADD COLUMN IF NOT EXISTS bank_expiry_months integer NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS ponto_espelho_signature (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES ponto_employee(id) ON DELETE CASCADE,
  ref_month       date NOT NULL,                          -- 1º dia do mês de competência
  content_hash    text NOT NULL,                          -- SHA-256 do conteúdo do espelho
  signature_image_url text,                               -- assinatura manuscrita/carimbo
  signer_ip       text,
  a1_signed       boolean NOT NULL DEFAULT false,         -- assinado com A1 (ICP-Brasil)?
  a1_subject      text,
  p7s_key         text,                                   -- .p7s no bucket privado (se A1)
  signed_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_id, ref_month)
);
ALTER TABLE ponto_espelho_signature ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ponto_espelho_signature_rls ON ponto_espelho_signature;
CREATE POLICY ponto_espelho_signature_rls ON ponto_espelho_signature
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_ponto_espelho_sig ON ponto_espelho_signature (organization_id, employee_id, ref_month);
