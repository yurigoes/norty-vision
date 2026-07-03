-- ==============================================================================
-- 027_credit.sql
-- Sistema de crediário completo:
--   products            — catalogo com 4 precos + juros + desconto antecipacao
--   org_credit_config   — parametros de crediario por organizacao (1 por org)
--   credit_accounts     — conta de crediario por (org, documento) — cross-loja
--   credit_limit_requests — pedidos de aumento de limite (pendente -> aprovado)
--   sales / sale_items  — venda registrada pelo operador
--   credit_purchases    — venda no crediario (gera parcelas)
--   credit_installments — parcelas (multa/juros/desconto/comprovante)
--   credit_account_events — audit imutavel (regra 11)
--
-- Crediario e POR ORGANIZACAO: o limite vale em qualquer loja da rede.
-- A identidade do titular e o documento (CPF/CNPJ), nao o customer_id
-- (que e por loja). Multiplas dividas ativas OK dentro do limite.
--   limite_disponivel = limit_cents - used_cents
--   used_cents = soma de (financiado - pago) das compras ativas
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PRODUCTS — catalogo. organization_id obrigatorio; store_id NULL = todas lojas.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,

  sku             text,
  name            text NOT NULL,
  description     text,
  category        text,

  -- 4 precos (em centavos). O cliente final so ve o preco final escolhido.
  price_cash_cents              int,   -- a vista (dinheiro/pix)
  price_card_full_cents         int,   -- cartao a vista
  price_card_installments_cents int,   -- cartao parcelado
  price_credit_cents            int,   -- crediario (ja com juros embutido)

  -- se price_credit_cents for NULL, calcula a partir de price_cash + esse %
  credit_interest_pct           numeric(6,3),

  -- desconto por pagamento antecipado de parcela (regra do produto;
  -- se NULL usa o default da org)
  early_payment_discount_pct    numeric(6,3),

  -- limite de parcelamento desse produto (NULL = usa default da org)
  max_installments              int,

  -- estoque (regra 14 — alerta de limite tratado na app)
  stock_qty       int NOT NULL DEFAULT 0,
  track_stock     boolean NOT NULL DEFAULT false,

  is_active       boolean NOT NULL DEFAULT true,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_org_idx ON products (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_active_idx ON products (organization_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_name_trgm ON products USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_products_updated_at ON products;
CREATE TRIGGER tg_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_rls ON products;
CREATE POLICY products_rls ON products FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- ORG_CREDIT_CONFIG — parametros de crediario por org. Defaults BR.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_credit_config (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  default_max_installments      int NOT NULL DEFAULT 12,

  -- multa por atraso (CDC art. 52 §1: maximo 2%)
  late_fee_pct                  numeric(6,3) NOT NULL DEFAULT 2.0,
  -- juros de mora ao mes (padrao legal 1%/mes, proporcional aos dias)
  monthly_interest_pct          numeric(6,3) NOT NULL DEFAULT 1.0,
  -- correcao monetaria opcional ao mes
  monthly_correction_pct        numeric(6,3) NOT NULL DEFAULT 0.0,

  -- juros pra calcular preco crediario quando produto nao define
  default_credit_interest_pct   numeric(6,3) NOT NULL DEFAULT 0.0,
  -- desconto padrao por antecipacao
  default_early_payment_discount_pct numeric(6,3) NOT NULL DEFAULT 0.0,

  -- operador pode dar ate X% de desconto sem autorizacao gerencial (regra 3)
  max_operator_discount_pct     numeric(6,3) NOT NULL DEFAULT 0.0,

  -- bloqueio automatico apos N parcelas vencidas (regra 8)
  auto_block_after_overdue_count int NOT NULL DEFAULT 3,

  -- cartao recorrente: retry (regra G3)
  card_retry_max_attempts       int NOT NULL DEFAULT 3,
  card_retry_intervals_hours    jsonb NOT NULL DEFAULT '[1,24,72]'::jsonb,

  -- exige contrato assinado antes de liberar crediario
  require_signed_contract       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_org_credit_config_updated_at ON org_credit_config;
CREATE TRIGGER tg_org_credit_config_updated_at BEFORE UPDATE ON org_credit_config
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE org_credit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_credit_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_credit_config_rls ON org_credit_config;
CREATE POLICY org_credit_config_rls ON org_credit_config FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- CREDIT_ACCOUNTS — uma por (org, documento). Identidade cross-loja.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_accounts (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- identidade do titular (cross-loja)
  document        text NOT NULL,             -- CPF/CNPJ normalizado
  holder_name     text NOT NULL,
  -- referencia opcional a um customer (pra exibir / contato)
  primary_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,

  -- limite e uso (centavos). used materializado; recalculo no service.
  limit_cents     bigint NOT NULL DEFAULT 0 CHECK (limit_cents >= 0),
  used_cents      bigint NOT NULL DEFAULT 0 CHECK (used_cents >= 0),

  -- estado
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','blocked','frozen','defaulted')),
  blocked_reason  text,
  blocked_at      timestamptz,
  blocked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  frozen_until    date,                       -- regra 5 (pause/freeze)

  -- score interno 0..100 (regra 4)
  score           int NOT NULL DEFAULT 100 CHECK (score BETWEEN 0 AND 100),

  -- avalista opcional (regra 6)
  guarantor_name      text,
  guarantor_document  text,
  guarantor_phone     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (organization_id, document)
);

CREATE INDEX IF NOT EXISTS credit_accounts_org_idx ON credit_accounts (organization_id);
CREATE INDEX IF NOT EXISTS credit_accounts_status_idx ON credit_accounts (organization_id, status);

DROP TRIGGER IF EXISTS tg_credit_accounts_updated_at ON credit_accounts;
CREATE TRIGGER tg_credit_accounts_updated_at BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_accounts_rls ON credit_accounts;
CREATE POLICY credit_accounts_rls ON credit_accounts FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- CREDIT_LIMIT_REQUESTS — pedidos de aumento (pendente ate aprovacao)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_limit_requests (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,

  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  current_limit_cents  bigint NOT NULL,
  requested_limit_cents bigint NOT NULL,
  reason          text,

  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),

  -- como foi autorizado: painel (admin/master clicou) ou token (2FA gerencial)
  authorized_via  text CHECK (authorized_via IN ('panel','token')),
  authorizer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  authorizer_name text,

  reviewed_at     timestamptz,
  review_note     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_limit_requests_pending_idx
  ON credit_limit_requests (organization_id, created_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS tg_credit_limit_requests_updated_at ON credit_limit_requests;
CREATE TRIGGER tg_credit_limit_requests_updated_at BEFORE UPDATE ON credit_limit_requests
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE credit_limit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_limit_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_limit_requests_rls ON credit_limit_requests;
CREATE POLICY credit_limit_requests_rls ON credit_limit_requests FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- SALES — venda registrada pelo operador
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,

  total_cents     bigint NOT NULL DEFAULT 0,
  payment_method  text NOT NULL
                  CHECK (payment_method IN ('cash','pix','card_full','card_installments','credit')),

  discount_pct_applied  numeric(6,3) NOT NULL DEFAULT 0,
  discount_authorized_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  discount_authorized_via text CHECK (discount_authorized_via IN ('operator','panel','token')),

  -- se crediario:
  credit_purchase_id uuid,    -- FK adicionada depois (credit_purchases ainda nao existe)

  -- nota fiscal anexada (cliente baixa no painel) — armazenada no MinIO
  nota_fiscal_url text,

  status          text NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('completed','canceled')),
  notes           text,

  short_code      text UNIQUE,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_org_idx ON sales (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_store_idx ON sales (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales (customer_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_sales_updated_at ON sales;
CREATE TRIGGER tg_sales_updated_at BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- short_code via mesmo padrao dos appointments
CREATE OR REPLACE FUNCTION app.tg_sale_short_code() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE candidate text; attempt int := 0;
BEGIN
  IF NEW.short_code IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    candidate := app.short_code(8);
    attempt := attempt + 1;
    IF NOT EXISTS (SELECT 1 FROM sales WHERE short_code = candidate) THEN
      NEW.short_code := candidate; EXIT;
    END IF;
    IF attempt >= 5 THEN RAISE EXCEPTION 'short_code sales falhou'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tg_sales_short_code ON sales;
CREATE TRIGGER tg_sales_short_code BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION app.tg_sale_short_code();

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_rls ON sales;
CREATE POLICY sales_rls ON sales FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- SALE_ITEMS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_items (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sale_id         uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,

  product_name    text NOT NULL,              -- congelado
  qty             int NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_cents bigint NOT NULL,
  price_type      text NOT NULL DEFAULT 'cash'
                  CHECK (price_type IN ('cash','card_full','card_installments','credit')),
  line_total_cents bigint NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items (sale_id);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_items_rls ON sale_items;
CREATE POLICY sale_items_rls ON sale_items FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- CREDIT_PURCHASES — venda no crediario (gera parcelas)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_purchases (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE RESTRICT,
  sale_id         uuid REFERENCES sales(id) ON DELETE SET NULL,

  total_cents     bigint NOT NULL,            -- valor total no crediario
  down_payment_cents bigint NOT NULL DEFAULT 0, -- entrada
  financed_cents  bigint NOT NULL,            -- total - entrada
  installments_count int NOT NULL CHECK (installments_count > 0),

  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paid','defaulted','renegotiated','canceled')),

  -- contrato assinado (G4)
  contract_id     uuid REFERENCES contracts(id) ON DELETE SET NULL,

  -- renegociacao (regra 2): aponta pra compra origem
  renegotiated_from_id uuid REFERENCES credit_purchases(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS credit_purchases_account_idx ON credit_purchases (credit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_purchases_status_idx ON credit_purchases (organization_id, status);

DROP TRIGGER IF EXISTS tg_credit_purchases_updated_at ON credit_purchases;
CREATE TRIGGER tg_credit_purchases_updated_at BEFORE UPDATE ON credit_purchases
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_purchases_rls ON credit_purchases;
CREATE POLICY credit_purchases_rls ON credit_purchases FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- agora a FK de sales.credit_purchase_id
ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_credit_purchase_fk;
ALTER TABLE sales
  ADD CONSTRAINT sales_credit_purchase_fk
  FOREIGN KEY (credit_purchase_id) REFERENCES credit_purchases(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- CREDIT_INSTALLMENTS — parcelas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_installments (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_purchase_id uuid NOT NULL REFERENCES credit_purchases(id) ON DELETE CASCADE,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE RESTRICT,

  number          int NOT NULL,               -- 1..N
  due_date        date NOT NULL,
  amount_cents    bigint NOT NULL,            -- valor base da parcela

  -- acrescimos quando vencida
  late_fee_cents      bigint NOT NULL DEFAULT 0,
  interest_cents      bigint NOT NULL DEFAULT 0,
  correction_cents    bigint NOT NULL DEFAULT 0,
  -- desconto aplicado (antecipacao)
  discount_cents      bigint NOT NULL DEFAULT 0,

  -- pagamento
  paid_amount_cents   bigint NOT NULL DEFAULT 0,
  paid_at         timestamptz,
  payment_method  text CHECK (payment_method IN ('pix','card_recurring','card_single','cash','in_person')),

  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','late','canceled','renegotiated')),

  -- Mercado Pago (G3)
  mp_payment_id      text,
  mp_preapproval_id  text,
  mp_init_point      text,            -- link de pagamento gerado

  -- comprovante (regra 10) — PDF no MinIO
  proof_url       text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (credit_purchase_id, number)
);

CREATE INDEX IF NOT EXISTS credit_installments_account_idx ON credit_installments (credit_account_id, due_date);
CREATE INDEX IF NOT EXISTS credit_installments_due_idx ON credit_installments (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS credit_installments_overdue_idx
  ON credit_installments (due_date) WHERE status IN ('pending','late');

DROP TRIGGER IF EXISTS tg_credit_installments_updated_at ON credit_installments;
CREATE TRIGGER tg_credit_installments_updated_at BEFORE UPDATE ON credit_installments
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE credit_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_installments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_installments_rls ON credit_installments;
CREATE POLICY credit_installments_rls ON credit_installments FOR ALL
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

-- ------------------------------------------------------------------------------
-- CREDIT_ACCOUNT_EVENTS — audit imutavel (regra 11)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_account_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_account_id uuid NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,

  event_type      text NOT NULL CHECK (event_type IN (
    'account_created','limit_set','limit_increased','limit_decreased',
    'limit_requested','limit_approved','limit_rejected',
    'blocked','unblocked','frozen','unfrozen',
    'purchase_created','payment_received','payment_failed',
    'installment_late','defaulted','renegotiated','score_changed','note'
  )),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  actor_type      text CHECK (actor_type IN ('system','staff','customer','platform')),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label     text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_account_events_acct_idx
  ON credit_account_events (credit_account_id, created_at DESC);

ALTER TABLE credit_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_account_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_account_events_read ON credit_account_events;
CREATE POLICY credit_account_events_read ON credit_account_events FOR SELECT
  USING (app.is_platform_admin() OR organization_id = app.current_org_id());
DROP POLICY IF EXISTS credit_account_events_write ON credit_account_events;
CREATE POLICY credit_account_events_write ON credit_account_events FOR INSERT
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());

COMMENT ON TABLE credit_accounts IS
  'Conta de crediario por (org, documento). Limite vale em qualquer loja da rede.';
COMMENT ON TABLE credit_installments IS
  'Parcelas. Multa (CDC 2%) + juros mora (1%/mes) calculados quando vence. Desconto por antecipacao.';
COMMENT ON TABLE credit_account_events IS
  'Audit imutavel append-only do crediario. Toda alteracao de limite/bloqueio/pagamento gera evento.';
