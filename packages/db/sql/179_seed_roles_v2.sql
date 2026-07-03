-- ==============================================================================
-- 179_seed_roles_v2.sql
-- Re-seeds os papéis padrão (owner/admin/manager/recepcao/medico/vendedor/
-- readonly) com permissions no formato NOVO: chaves planas tipo "agenda.view"
-- mapeadas no PERMISSION_CATALOG do users.service.ts.
--
-- Os papéis legados tinham permissions aninhados ({"appointments":{"read":"store"}})
-- que não casavam com nenhuma chave do catálogo nem com @RequirePermission.
-- Resultado: usuários com esses papéis só passavam quando o code checa role.slug
-- diretamente. Agora todo @RequirePermission funciona.
--
-- owner/admin continuam ignorando o catálogo (acesso total via isOrgAdmin),
-- mas populamos as chaves pra fica explícito + futuro-proofing.
-- ==============================================================================

UPDATE roles SET permissions = '{
  "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.cancel": true, "agenda.view_others": true,
  "professionals.view": true, "professionals.manage": true,
  "customers.view": true, "customers.create": true, "customers.edit": true, "customers.delete": true, "customers.export": true,
  "sales.view": true, "sales.create": true, "sales.discount": true, "sales.cancel": true, "sales.refund": true,
  "products.view": true, "products.create": true, "products.edit": true, "products.delete": true, "products.price": true, "products.stock": true, "products.import": true,
  "production.view": true, "production.create": true, "production.update_status": true, "production.assign": true, "production.cancel": true,
  "fiscal.nfce.emit": true, "fiscal.nfce.cancel": true, "fiscal.nfe.emit": true, "fiscal.nfe.cancel": true, "fiscal.nfse.emit": true, "fiscal.nfse.cancel": true, "fiscal.config": true,
  "credit.view": true, "credit.approve": true, "credit.collect": true, "credit.write_off": true,
  "cashbox.open": true, "cashbox.close": true, "cashbox.adjust": true, "cashbox.view_all": true, "payments.config": true,
  "leads.view": true, "leads.create": true, "leads.assign": true, "crm.pipeline_manage": true, "crm.supervise": true,
  "chat.respond": true, "chat.view_all": true, "voip.call_internal": true, "voip.call_external": true, "voip.admin": true,
  "broadcast.view": true, "broadcast.send": true, "templates.manage": true,
  "reports.sales": true, "reports.financial": true, "reports.commission": true, "reports.production": true, "reports.bi_panel": true,
  "lens.orders": true, "lens.batches": true, "payouts.manage": true, "suppliers.manage": true,
  "contracts.view": true, "contracts.manage": true, "contracts.sign": true,
  "stores.manage": true, "users.manage": true, "roles.manage": true, "integrations.manage": true, "settings.org": true,
  "tickets.create": true, "tickets.view": true
}'::jsonb, updated_at = now()
WHERE slug IN ('owner','admin') AND organization_id IS NULL;

-- MANAGER: tudo do operacional da loja, sem config da empresa nem fiscal config
UPDATE roles SET permissions = '{
  "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.cancel": true, "agenda.view_others": true,
  "professionals.view": true, "professionals.manage": true,
  "customers.view": true, "customers.create": true, "customers.edit": true, "customers.export": true,
  "sales.view": true, "sales.create": true, "sales.discount": true, "sales.cancel": true, "sales.refund": true,
  "products.view": true, "products.edit": true, "products.price": true, "products.stock": true,
  "production.view": true, "production.create": true, "production.update_status": true, "production.assign": true,
  "fiscal.nfce.emit": true, "fiscal.nfce.cancel": true, "fiscal.nfe.emit": true, "fiscal.nfse.emit": true,
  "credit.view": true, "credit.approve": true, "credit.collect": true,
  "cashbox.open": true, "cashbox.close": true, "cashbox.adjust": true, "cashbox.view_all": true,
  "leads.view": true, "leads.create": true, "leads.assign": true, "crm.supervise": true,
  "chat.respond": true, "chat.view_all": true, "voip.call_internal": true, "voip.call_external": true,
  "broadcast.view": true, "broadcast.send": true,
  "reports.sales": true, "reports.financial": true, "reports.commission": true, "reports.production": true,
  "lens.orders": true, "lens.batches": true,
  "contracts.view": true, "contracts.manage": true, "contracts.sign": true,
  "tickets.create": true, "tickets.view": true
}'::jsonb, updated_at = now()
WHERE slug = 'manager' AND organization_id IS NULL;

-- RECEPCAO: agenda + clientes + chat. VÊ profissionais (pra agendar) mas não cadastra.
UPDATE roles SET permissions = '{
  "agenda.view": true, "agenda.create": true, "agenda.edit": true, "agenda.cancel": true, "agenda.view_others": true,
  "professionals.view": true,
  "customers.view": true, "customers.create": true, "customers.edit": true,
  "chat.respond": true, "voip.call_internal": true, "voip.call_external": true,
  "leads.view": true, "leads.create": true,
  "templates.manage": false,
  "tickets.create": true
}'::jsonb, updated_at = now()
WHERE slug = 'recepcao' AND organization_id IS NULL;

-- MEDICO/Profissional: vê própria agenda + clientes (sem cadastrar/editar)
UPDATE roles SET permissions = '{
  "agenda.view": true, "agenda.edit": true,
  "professionals.view": true,
  "customers.view": true,
  "voip.call_internal": true
}'::jsonb, updated_at = now()
WHERE slug = 'medico' AND organization_id IS NULL;

-- VENDEDOR: leads + vendas + clientes
UPDATE roles SET permissions = '{
  "customers.view": true, "customers.create": true, "customers.edit": true,
  "sales.view": true, "sales.create": true,
  "products.view": true,
  "leads.view": true, "leads.create": true, "leads.assign": true,
  "chat.respond": true, "voip.call_internal": true, "voip.call_external": true,
  "broadcast.view": true,
  "reports.commission": true,
  "tickets.create": true
}'::jsonb, updated_at = now()
WHERE slug = 'vendedor' AND organization_id IS NULL;

-- READONLY: só visualização nos principais módulos
UPDATE roles SET permissions = '{
  "agenda.view": true, "agenda.view_others": true,
  "professionals.view": true,
  "customers.view": true,
  "sales.view": true,
  "products.view": true,
  "production.view": true,
  "credit.view": true,
  "leads.view": true,
  "broadcast.view": true,
  "reports.sales": true, "reports.financial": true, "reports.production": true,
  "contracts.view": true,
  "tickets.view": true
}'::jsonb, updated_at = now()
WHERE slug = 'readonly' AND organization_id IS NULL;
