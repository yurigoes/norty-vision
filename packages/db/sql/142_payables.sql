-- ==============================================================================
-- 142_payables.sql  (idempotente)  —  FINANCEIRO: Contas a Pagar
--
-- Gestão de contas a pagar (única ou parcelada), com anexos (boleto/DANFE/XML/
-- comprovante), baixa com dados do pagamento, e destinatários de notificação.
-- Org-scoped (RLS por organização). Relatórios e cron de aviso vêm nas fases 3/4.
-- ==============================================================================

-- Conta/título a pagar (cabeçalho). Parcelas ficam em payable_installment.
CREATE TABLE IF NOT EXISTS payable (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  supplier        text,                                  -- fornecedor / favorecido
  description     text,
  category        text,                                  -- ex.: aluguel, energia, fornecedor
  doc_type        text NOT NULL DEFAULT 'avulso',         -- boleto | danfe | avulso | recorrente
  doc_number      text,                                  -- nº NF / documento
  nfe_key         text,                                  -- chave da NF-e (quando DANFE)
  total_cents     bigint NOT NULL DEFAULT 0,
  issue_date      date,
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payable_rls ON payable;
CREATE POLICY payable_rls ON payable
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_payable_org ON payable (organization_id, created_at DESC);

-- Parcela (1 para conta única; N para parcelada). É o que vence/paga/notifica.
CREATE TABLE IF NOT EXISTS payable_installment (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payable_id      uuid NOT NULL REFERENCES payable(id) ON DELETE CASCADE,
  number          integer NOT NULL DEFAULT 1,
  due_date        date NOT NULL,
  amount_cents    bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'a_pagar',        -- a_pagar | pago | cancelado (vencido é derivado da data)
  paid_at         date,
  paid_cents      bigint,
  payment_method  text,                                  -- pix | boleto | cartao | dinheiro | transferencia
  barcode         text,                                  -- linha digitável / código de barras do boleto
  proof_url       text,                                  -- comprovante (bucket privado)
  notify_sent_at  timestamptz,                           -- controle do cron de aviso (fase 4)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payable_installment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payable_installment_rls ON payable_installment;
CREATE POLICY payable_installment_rls ON payable_installment
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_payable_inst_due ON payable_installment (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_payable_inst_payable ON payable_installment (payable_id);

-- Anexos: boleto / DANFE(pdf) / XML da NF-e / comprovante, com dados extraídos.
CREATE TABLE IF NOT EXISTS payable_attachment (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payable_id      uuid REFERENCES payable(id) ON DELETE CASCADE,
  installment_id  uuid REFERENCES payable_installment(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'comprovante',     -- boleto | danfe | nfe_xml | comprovante | outro
  url             text NOT NULL,
  filename        text,
  extracted       jsonb NOT NULL DEFAULT '{}'::jsonb,      -- dados lidos/confirmados (valor, vencimento, emitente, chave)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payable_attachment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payable_attachment_rls ON payable_attachment;
CREATE POLICY payable_attachment_rls ON payable_attachment
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_payable_att ON payable_attachment (organization_id, payable_id);

-- Destinatários das notificações de contas a pagar (dono + pessoas adicionadas).
CREATE TABLE IF NOT EXISTS payable_notify_recipient (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text,
  whatsapp        text,
  events          text[] NOT NULL DEFAULT ARRAY['a_vencer','vencido']::text[],
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payable_notify_recipient ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payable_notify_rls ON payable_notify_recipient;
CREATE POLICY payable_notify_rls ON payable_notify_recipient
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
