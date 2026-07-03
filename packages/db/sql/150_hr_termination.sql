-- ==============================================================================
-- 150_hr_termination.sql  (idempotente)  —  RH: Rescisão / desligamento
--
-- Fluxo de desligamento com checklist: ASO demissional, devolução de EPI/ativos,
-- baixa de acessos, entrega de documentos (TRCT/guias) e aviso prévio. Ao
-- finalizar, marca termination_date e inativa o funcionário (e o ponto).
-- Org-scoped (RLS por organização). 1 desligamento por funcionário.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS employee_termination (
  id              uuid PRIMARY KEY DEFAULT app.new_id(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'sem_justa_causa', -- sem_justa_causa|pedido_demissao|justa_causa|acordo|fim_contrato|aposentadoria
  notice_type     text NOT NULL DEFAULT 'trabalhado',      -- trabalhado|indenizado|dispensado
  notice_date     date,
  termination_date date,
  reason          text,
  aso_done        boolean NOT NULL DEFAULT false,          -- ASO demissional realizado
  assets_returned boolean NOT NULL DEFAULT false,          -- EPI/uniforme/equipamentos
  access_revoked  boolean NOT NULL DEFAULT false,          -- sistemas/crachá
  docs_delivered  boolean NOT NULL DEFAULT false,          -- TRCT/guias/exame
  term_doc_url    text,                                    -- termo/comunicado assinado
  status          text NOT NULL DEFAULT 'open',            -- open | finalized
  finalized_at    timestamptz,
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_id)
);
ALTER TABLE employee_termination ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_termination_rls ON employee_termination;
CREATE POLICY employee_termination_rls ON employee_termination
  USING (app.is_platform_admin() OR organization_id = app.current_org_id())
  WITH CHECK (app.is_platform_admin() OR organization_id = app.current_org_id());
CREATE INDEX IF NOT EXISTS ix_employee_termination ON employee_termination (organization_id, employee_id);
