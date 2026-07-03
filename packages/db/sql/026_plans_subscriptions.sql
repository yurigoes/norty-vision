-- ==============================================================================
-- 026_plans_subscriptions.sql
-- Catalogo de planos + assinaturas + log de eventos do gateway (Mercado Pago).
--
-- Modelo:
--   plans              — catalogo (configurado pelo master)
--   subscriptions      — uma por organization (status: trialing/active/past_due/canceled)
--   subscription_events — log de webhooks/mudancas (auditoria + idempotencia)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- plans
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  highlight       text,          -- "mais popular", "melhor custo-beneficio", etc

  -- preco
  price_cents     int NOT NULL,
  currency        text NOT NULL DEFAULT 'BRL',
  interval        text NOT NULL DEFAULT 'monthly'
                  CHECK (interval IN ('monthly','yearly')),

  -- trial
  trial_days      int NOT NULL DEFAULT 14,

  -- limites (futuro: enforcement via app)
  max_stores      int,           -- NULL = ilimitado
  max_users       int,
  max_messages_month int,

  -- features (lista pra exibir no pricing)
  features        jsonb NOT NULL DEFAULT '[]'::jsonb,

  is_active       boolean NOT NULL DEFAULT true,
  display_order   int NOT NULL DEFAULT 0,

  -- IDs externos no MP (preenchidos quando o plano e sincronizado com MP)
  mp_plan_id      text,          -- preapproval_plan_id no MP

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_active_idx
  ON plans (display_order) WHERE is_active;

DROP TRIGGER IF EXISTS tg_plans_updated_at ON plans;
CREATE TRIGGER tg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- RLS: leitura publica (precisa pra /planos), escrita so master
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_read ON plans;
CREATE POLICY plans_read ON plans
  FOR SELECT
  USING (is_active OR app.is_platform_admin());

DROP POLICY IF EXISTS plans_write ON plans;
CREATE POLICY plans_write ON plans
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- subscriptions
-- Uma por organization. Quando muda de plano, o registro continua e a gente
-- atualiza plan_id + reseta period boundaries.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,

  status          text NOT NULL DEFAULT 'trialing'
                  CHECK (status IN ('trialing','active','past_due','canceled','paused')),

  -- ciclo atual
  current_period_start timestamptz,
  current_period_end   timestamptz,
  trial_ends_at        timestamptz,

  -- Mercado Pago
  mp_subscription_id   text,           -- preapproval_id
  mp_payer_email       text,
  mp_init_point        text,           -- URL de pagamento (gerada no checkout)

  -- cancelamento
  canceled_at          timestamptz,
  cancel_reason        text,
  ends_at              timestamptz,    -- quando vai parar de cobrar (cancel agendado)

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);
CREATE INDEX IF NOT EXISTS subscriptions_mp_idx     ON subscriptions (mp_subscription_id);

DROP TRIGGER IF EXISTS tg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER tg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_read ON subscriptions;
CREATE POLICY subscriptions_read ON subscriptions
  FOR SELECT
  USING (app.is_platform_admin() OR organization_id = app.current_org_id());

DROP POLICY IF EXISTS subscriptions_write ON subscriptions;
CREATE POLICY subscriptions_write ON subscriptions
  FOR ALL
  USING (app.is_platform_admin() OR (organization_id = app.current_org_id() AND app.is_org_admin()))
  WITH CHECK (app.is_platform_admin() OR (organization_id = app.current_org_id() AND app.is_org_admin()));

-- ------------------------------------------------------------------------------
-- subscription_events
-- Log de eventos do gateway (webhook Mercado Pago). Idempotencia via mp_event_id.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_events (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  source          text NOT NULL DEFAULT 'mercadopago',
  event_type      text NOT NULL,        -- 'payment.created', 'preapproval.updated', etc
  mp_event_id     text UNIQUE,          -- id do evento MP (idempotencia)
  mp_payment_id   text,                 -- payment.id quando aplicavel
  amount_cents    int,
  status          text,                 -- approved/pending/rejected/cancelled
  raw_payload     jsonb,                -- payload bruto do webhook

  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_sub_idx
  ON subscription_events (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_org_idx
  ON subscription_events (organization_id, created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_events_read ON subscription_events;
CREATE POLICY subscription_events_read ON subscription_events
  FOR SELECT
  USING (app.is_platform_admin() OR organization_id = app.current_org_id());

DROP POLICY IF EXISTS subscription_events_write ON subscription_events;
CREATE POLICY subscription_events_write ON subscription_events
  FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- ------------------------------------------------------------------------------
-- Seed: 3 planos base (gratis trial, pro, business)
-- ------------------------------------------------------------------------------
INSERT INTO plans (slug, name, description, highlight, price_cents, interval,
                   trial_days, max_stores, max_users, max_messages_month,
                   features, display_order)
VALUES
  ('starter', 'Starter',
   'Pra quem ta comecando. 1 loja, ate 3 usuarios, 1.000 mensagens/mes.',
   NULL,
   4900, 'monthly', 14, 1, 3, 1000,
   '["1 loja","3 usuarios","1.000 mensagens/mes","Agenda + Leads","Disparador basico","Suporte por email"]'::jsonb,
   1),

  ('pro', 'Pro',
   'Pra equipes em crescimento. Multi-loja, usuarios ilimitados, NLU.',
   'Mais popular',
   14900, 'monthly', 14, 5, 20, 10000,
   '["Ate 5 lojas","20 usuarios","10.000 mensagens/mes","Tudo do Starter","NLU avancado","Templates personalizados","Relatorios","Suporte prioritario"]'::jsonb,
   2),

  ('business', 'Business',
   'Pra operacoes maiores. Lojas ilimitadas, usuarios ilimitados, SLA.',
   NULL,
   29900, 'monthly', 14, NULL, NULL, 50000,
   '["Lojas ilimitadas","Usuarios ilimitados","50.000 mensagens/mes","Tudo do Pro","Integracoes customizadas","SLA 99.9%","Onboarding dedicado","Suporte 24/7"]'::jsonb,
   3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  highlight = EXCLUDED.highlight,
  price_cents = EXCLUDED.price_cents,
  features = EXCLUDED.features,
  updated_at = now();

-- ------------------------------------------------------------------------------
-- Adicionar provider 'mercadopago' em platform_integrations se ainda nao tem.
-- (DO block evita problemas com ON CONFLICT em constraint UNIQUE NULLS NOT DISTINCT)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_integrations
    WHERE provider = 'mercadopago' AND organization_id IS NULL
  ) THEN
    INSERT INTO platform_integrations (provider, label, description, base_url, status)
    VALUES ('mercadopago', 'Mercado Pago',
            'Gateway de pagamentos pra assinaturas recorrentes (preapproval).',
            'https://api.mercadopago.com', 'disabled');
  END IF;
END $$;

COMMENT ON TABLE plans IS
  'Catalogo de planos da plataforma. RLS abre leitura publica para is_active=true.';
COMMENT ON TABLE subscriptions IS
  'Uma assinatura por organization. RLS restringe leitura/escrita ao owner+admin da org.';
COMMENT ON TABLE subscription_events IS
  'Log de webhooks do gateway. Usado pra auditoria + idempotencia (mp_event_id UNIQUE).';
