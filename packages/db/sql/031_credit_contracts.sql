-- ==============================================================================
-- 031_credit_contracts.sql
-- Contratos de crediario com biometria (selfie + assinatura) no painel do
-- cliente. Estende contract_templates/contracts da fase D.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- contract_templates: tipo + biometria
-- ------------------------------------------------------------------------------
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'generic'
  CHECK (kind IN ('generic','credit'));
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS biometric_required boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------------------------
-- contracts: vinculo com conta de crediario + selfie + via de assinatura
-- ------------------------------------------------------------------------------
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS credit_account_id uuid REFERENCES credit_accounts(id) ON DELETE SET NULL;
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS selfie_url text;
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signed_via text;  -- 'portal' | 'public_token'

CREATE INDEX IF NOT EXISTS contracts_credit_account_idx
  ON contracts (credit_account_id) WHERE credit_account_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- Seed: template global de contrato de crediario (com biometria)
-- ------------------------------------------------------------------------------
INSERT INTO contract_templates (
  organization_id, slug, title, description, body_markdown, fields_schema,
  signature_mode, kind, biometric_required, is_active
)
VALUES (
  NULL,
  'contrato-crediario-padrao',
  'Contrato de Crediario',
  'Termo de concessao de crediario (confissao de divida e condicoes).',
$body$
# Contrato de Concessao de Crediario

Pelo presente instrumento, **{{nome_completo}}**, portador do CPF
**{{cpf}}**, residente em **{{endereco}}**, doravante CLIENTE, declara estar
ciente e de acordo com as condicoes do crediario concedido pela loja.

## 1. Do Crediario

O CLIENTE recebe um limite de crediario a ser utilizado em compras na rede.
O uso do crediario implica aceite integral deste contrato.

## 2. Das Parcelas e Encargos

- As compras serao divididas em parcelas mensais conforme acordado no ato.
- Em caso de atraso: multa de 2% sobre o valor da parcela + juros de mora de
  1% ao mes (proporcional aos dias), conforme legislacao vigente (CDC).
- O pagamento antecipado pode gerar desconto conforme politica da loja.

## 3. Da Confissao de Divida

O CLIENTE reconhece a legitimidade dos valores lancados em seu crediario e
confessa a divida correspondente as compras realizadas, autorizando a
cobranca pelos meios cabiveis em caso de inadimplencia.

## 4. Da Autenticidade (Biometria)

A assinatura deste contrato e acompanhada de:
- Assinatura eletronica desenhada pelo proprio CLIENTE; e
- Selfie do CLIENTE segurando documento de identidade,

constituindo prova de autenticidade e autoria (Lei 14.063/2020 e MP 2.200-2/2001).

## 5. Da Protecao de Dados (LGPD)

Os dados e documentos fornecidos serao tratados conforme a Lei 13.709/2018,
exclusivamente para analise e gestao do crediario.

---

Ao assinar, o CLIENTE declara ter lido e concordado com todas as clausulas.
$body$,
  '[
    {"name":"nome_completo","label":"Nome completo","type":"text","required":true},
    {"name":"cpf","label":"CPF","type":"cpf","required":true},
    {"name":"endereco","label":"Endereco completo","type":"text","required":true}
  ]'::jsonb,
  'draw',
  'credit',
  true,
  true
)
ON CONFLICT (organization_id, slug, version) DO UPDATE SET
  kind = 'credit',
  biometric_required = true,
  signature_mode = 'draw',
  updated_at = now();

COMMENT ON COLUMN contracts.credit_account_id IS
  'Vincula o contrato a uma conta de crediario (assinado no portal do cliente).';
COMMENT ON COLUMN contracts.selfie_url IS
  'Selfie do cliente segurando documento, capturada na assinatura biometrica.';
