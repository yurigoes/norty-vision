-- ==============================================================================
-- 144_receivables.sql  (idempotente)  —  FINANCEIRO: Contas a Receber
--
-- Gestão de contas a receber (única ou parcelada), com anexos (comprovante de
-- recebimento etc.), baixa com dados do recebimento. Espelha payables.
-- Org-scoped (RLS por organização). Alimenta o Fluxo de Caixa (entradas).
-- ==============================================================================

-- Título a receber (cabeçalho). Parcelas ficam em receivable_installment.
CREATE TABLE IF NOT EXISTS receivable (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  payer           text,                                  -- pagador / cliente
  description     text,
  category        text,                                  -- ex.: serviço, venda, mensalidade
  doc_type        text NOT NULL DEFAULT 'avulso',         -- avulso | recorrente | venda
  doc_number      text,
  total_cents     bigint NOT NULL DEFAULT 0,
  issue_date      date,
  notes           text,
  recurring       boolean NOT NULL DEFAULT false,
  recurrence_day  integer,
  recurrence_amount_cents bigint,
  recurrence_until date,
  recurrence_last date,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE receivable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receivable_rls ON receivable;
CREATE POLICY receivable_rls ON receivable
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_receivable_org ON receivable (organization_id, created_at DESC);

-- Parcela (1 para única; N para parcelada). É o que vence/recebe.
CREATE TABLE IF NOT EXISTS receivable_installment (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receivable_id   uuid NOT NULL REFERENCES receivable(id) ON DELETE CASCADE,
  number          integer NOT NULL DEFAULT 1,
  due_date        date NOT NULL,
  amount_cents    bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'a_receber',      -- a_receber | recebido | cancelado (atrasado é derivado da data)
  paid_at         date,                                   -- data do recebimento
  paid_cents      bigint,
  payment_method  text,                                  -- pix | boleto | cartao | dinheiro | transferencia
  proof_url       text,                                  -- comprovante (bucket privado)
  notify_sent_at  timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE receivable_installment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receivable_installment_rls ON receivable_installment;
CREATE POLICY receivable_installment_rls ON receivable_installment
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_receivable_inst_due ON receivable_installment (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_receivable_inst_recv ON receivable_installment (receivable_id);

-- Anexos: comprovante de recebimento / outro.
CREATE TABLE IF NOT EXISTS receivable_attachment (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receivable_id   uuid REFERENCES receivable(id) ON DELETE CASCADE,
  installment_id  uuid REFERENCES receivable_installment(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'comprovante',     -- comprovante | outro
  url             text NOT NULL,
  filename        text,
  extracted       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE receivable_attachment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receivable_attachment_rls ON receivable_attachment;
CREATE POLICY receivable_attachment_rls ON receivable_attachment
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_receivable_att ON receivable_attachment (organization_id, receivable_id);
