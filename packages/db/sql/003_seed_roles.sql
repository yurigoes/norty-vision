-- ==============================================================================
-- 003_seed_roles.sql
-- Roles templates (organization_id = NULL) que toda nova organizacao copia.
-- ==============================================================================

INSERT INTO roles (slug, name, description, permissions, is_default, is_system, organization_id)
VALUES
  -- owner: tudo, incluindo billing
  ('owner', 'Proprietario', 'Acesso total a organizacao, incluindo billing e exclusao.',
   '{
     "billing":      {"read":"org",   "write":"org"},
     "organization": {"read":"org",   "write":"org"},
     "stores":       {"read":"org",   "write":"org"},
     "users":        {"read":"org",   "write":"org"},
     "appointments": {"read":"org",   "write":"org"},
     "leads":        {"read":"org",   "write":"org"},
     "campaigns":    {"read":"org",   "write":"org"},
     "audit_log":    {"read":"org",   "write":"none"}
   }'::jsonb,
   false, true, NULL),

  -- admin: tudo menos billing
  ('admin', 'Administrador', 'Acesso administrativo a organizacao. Sem billing.',
   '{
     "organization": {"read":"org",   "write":"org"},
     "stores":       {"read":"org",   "write":"org"},
     "users":        {"read":"org",   "write":"org"},
     "appointments": {"read":"org",   "write":"org"},
     "leads":        {"read":"org",   "write":"org"},
     "campaigns":    {"read":"org",   "write":"org"},
     "audit_log":    {"read":"org",   "write":"none"}
   }'::jsonb,
   false, true, NULL),

  -- manager: gerente de uma loja
  ('manager', 'Gerente', 'Gerente de loja. Le tudo da loja, escreve em quase tudo.',
   '{
     "stores":       {"read":"store", "write":"store"},
     "users":        {"read":"store", "write":"store"},
     "appointments": {"read":"store", "write":"store"},
     "leads":        {"read":"store", "write":"store"},
     "campaigns":    {"read":"store", "write":"store"},
     "audit_log":    {"read":"store", "write":"none"}
   }'::jsonb,
   false, true, NULL),

  -- recepcao: agenda + clientes
  ('recepcao', 'Recepcao', 'Recepcao. Agenda, confirma, atende clientes.',
   '{
     "appointments": {"read":"store", "write":"store"},
     "customers":    {"read":"store", "write":"store"},
     "leads":        {"read":"store", "write":"self"},
     "campaigns":    {"read":"store", "write":"none"}
   }'::jsonb,
   true, true, NULL),

  -- medico: ve sua agenda, atualiza prontuario
  ('medico', 'Profissional/Medico', 'Profissional que atende. Ve so sua propria agenda.',
   '{
     "appointments": {"read":"self",  "write":"self"},
     "customers":    {"read":"store", "write":"none"}
   }'::jsonb,
   false, true, NULL),

  -- vendedor: leads
  ('vendedor', 'Vendedor', 'Vendedor comercial. Trabalha leads atribuidos.',
   '{
     "leads":        {"read":"self",  "write":"self"},
     "customers":    {"read":"store", "write":"store"},
     "campaigns":    {"read":"store", "write":"none"}
   }'::jsonb,
   false, true, NULL),

  -- readonly: so leitura
  ('readonly', 'Somente leitura', 'Apenas leitura para auditores/diretores.',
   '{
     "stores":       {"read":"org",   "write":"none"},
     "appointments": {"read":"org",   "write":"none"},
     "leads":        {"read":"org",   "write":"none"},
     "campaigns":    {"read":"org",   "write":"none"},
     "audit_log":    {"read":"org",   "write":"none"}
   }'::jsonb,
   false, true, NULL)

ON CONFLICT (organization_id, slug) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  is_default  = EXCLUDED.is_default,
  is_system   = EXCLUDED.is_system,
  updated_at  = now();
