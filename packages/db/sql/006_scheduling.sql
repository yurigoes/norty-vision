-- ==============================================================================
-- 006_scheduling.sql
-- Coracao do sistema de agenda: templates, slots, appointments, eventos.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SCHEDULE_TEMPLATES - template de jornada semanal por profissional
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_templates (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,

  name            text NOT NULL,                          -- "Padrao Seg-Sex"

  -- jornada por dia da semana (0=domingo, 6=sabado)
  -- exemplo:
  -- [{ "weekday": 1, "blocks": [
  --     {"start":"08:00","end":"12:00","slot_minutes":15,"capacity":1},
  --     {"start":"14:00","end":"18:00","slot_minutes":15,"capacity":1}
  -- ]}]
  weekly_blocks   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- vigencia
  valid_from      date NOT NULL DEFAULT CURRENT_DATE,
  valid_until     date,

  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_templates_prof_idx
  ON schedule_templates (professional_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_schedule_templates_updated_at ON schedule_templates;
CREATE TRIGGER tg_schedule_templates_updated_at
  BEFORE UPDATE ON schedule_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- ------------------------------------------------------------------------------
-- SCHEDULE_SLOTS - slots concretos gerados a partir de template ou ad-hoc
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_slots (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,

  -- origem (qual template gerou; null = ad-hoc)
  template_id     uuid REFERENCES schedule_templates(id) ON DELETE SET NULL,

  -- horario absoluto (com tz da loja convertido pra UTC no insert)
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,

  -- capacidade total e usada (atomic decrement no agendamento)
  capacity        int NOT NULL DEFAULT 1 CHECK (capacity >= 0),
  used            int NOT NULL DEFAULT 0 CHECK (used >= 0),

  -- bloqueio (slot reservado pra outra coisa, almoco, etc)
  is_blocked      boolean NOT NULL DEFAULT false,
  block_reason    text,

  -- duracao padrao do atendimento neste slot (minutos)
  duration_minutes int NOT NULL DEFAULT 15,

  -- label visivel ("Manha", "Tarde", "Turno A") - opcional
  label           text,

  -- soft delete
  deleted_at      timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (ends_at > starts_at),
  CHECK (used <= capacity)
);

CREATE INDEX IF NOT EXISTS schedule_slots_store_starts_idx
  ON schedule_slots (store_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS schedule_slots_prof_starts_idx
  ON schedule_slots (professional_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS schedule_slots_available_idx
  ON schedule_slots (store_id, starts_at)
  WHERE deleted_at IS NULL AND is_blocked = false AND used < capacity;

-- evita slots duplicados pro mesmo profissional no mesmo horario
CREATE UNIQUE INDEX IF NOT EXISTS schedule_slots_unique
  ON schedule_slots (professional_id, starts_at)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS tg_schedule_slots_updated_at ON schedule_slots;
CREATE TRIGGER tg_schedule_slots_updated_at
  BEFORE UPDATE ON schedule_slots
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

COMMENT ON TABLE schedule_slots IS
  'Slot concreto. Capacity = quantos podem ser agendados (ex: 4 pacientes no mesmo horario). Used incrementa atomicamente no insert de appointment.';

-- ------------------------------------------------------------------------------
-- APPOINTMENTS - agendamento concreto
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,

  -- relacoes
  slot_id         uuid NOT NULL REFERENCES schedule_slots(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- desnormalizacao util (evita join em listagens)
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,

  -- estado
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','rescheduled','canceled','no_show','attended','in_progress')),

  -- detalhes
  service_name    text,                                    -- "Consulta de rotina"
  notes           text,                                    -- visivel pra equipe

  -- check-in/atendimento
  checked_in_at   timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,

  -- cancelamento/reagendamento
  canceled_at     timestamptz,
  canceled_reason text,
  canceled_by     text CHECK (canceled_by IN ('customer','staff','no_show','system')),
  rescheduled_to_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  rescheduled_from_id uuid REFERENCES appointments(id) ON DELETE SET NULL,

  -- origem
  source          text NOT NULL DEFAULT 'staff'
                  CHECK (source IN ('staff','self_service','import','integration','reschedule')),

  -- short_code pra URL publica de confirmacao
  short_code      text UNIQUE,

  -- soft delete
  deleted_at      timestamptz,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS appointments_store_date_idx
  ON appointments (store_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_prof_date_idx
  ON appointments (professional_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_customer_idx
  ON appointments (customer_id, starts_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON appointments (store_id, status, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_short_code_idx
  ON appointments (short_code) WHERE short_code IS NOT NULL AND deleted_at IS NULL;

-- bloqueia duplo agendamento ativo do mesmo customer na mesma data.
-- Usa coluna gerada (date_utc) pq date(timestamptz) nao e IMMUTABLE
-- (depende do timezone da sessao). Materializar em coluna stored
-- torna o indice viavel.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS starts_at_day_utc date
  GENERATED ALWAYS AS (date(starts_at AT TIME ZONE 'UTC')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_active_per_customer_per_day
  ON appointments (customer_id, starts_at_day_utc)
  WHERE deleted_at IS NULL
    AND status IN ('pending','confirmed','rescheduled','in_progress');

COMMENT ON COLUMN appointments.starts_at_day_utc IS
  'Auxiliar pra unique partial index. UTC date - regra de "1 active appointment por dia" pode passar voltas em fronteiras de tz; service layer deve refinar pra timezone da loja.';

DROP TRIGGER IF EXISTS tg_appointments_updated_at ON appointments;
CREATE TRIGGER tg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- trigger que gera short_code unico no insert
CREATE OR REPLACE FUNCTION app.tg_appointment_short_code() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  attempt int := 0;
  candidate text;
BEGIN
  IF NEW.short_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := app.short_code(8);
    attempt := attempt + 1;
    -- tenta inserir; se ja existir, gera outro (max 5 tentativas)
    IF NOT EXISTS (SELECT 1 FROM appointments WHERE short_code = candidate) THEN
      NEW.short_code := candidate;
      EXIT;
    END IF;
    IF attempt >= 5 THEN
      RAISE EXCEPTION 'Nao conseguiu gerar short_code unico apos 5 tentativas';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_appointments_short_code ON appointments;
CREATE TRIGGER tg_appointments_short_code
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.tg_appointment_short_code();

COMMENT ON TABLE appointments IS
  'Agendamento concreto. starts_at/ends_at desnormalizados do slot pra listagens rapidas.';

-- ------------------------------------------------------------------------------
-- APPOINTMENT_EVENTS - timeline imutavel de eventos por agendamento
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  appointment_id  uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,

  event_type      text NOT NULL CHECK (event_type IN (
    'created',
    'reminder_sent',
    'reminder_failed',
    'customer_replied',
    'confirmed',
    'reschedule_requested',
    'rescheduled',
    'cancel_requested',
    'canceled',
    'no_show',
    'checked_in',
    'attended',
    'note_added'
  )),

  -- payload livre (ex: {"channel":"whatsapp","template":"reminder_3d"})
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ator
  actor_type      text CHECK (actor_type IN ('system','staff','customer','platform')),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label     text,                                    -- ex: nome do staff, "WhatsApp +5511..."

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_events_appt_idx
  ON appointment_events (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_events_store_idx
  ON appointment_events (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_events_type_idx
  ON appointment_events (event_type, created_at DESC);

COMMENT ON TABLE appointment_events IS
  'Timeline imutavel por appointment. Append-only (nunca UPDATE). Base para auditoria e debug.';
