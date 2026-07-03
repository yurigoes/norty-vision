# ADR 0002 — Estratégia de Row-Level Security

**Status**: Aceito · **Data**: 2026-05-18

## Contexto

Multi-tenant compartilhado (ver [ADR 0001](./0001-multi-tenancy-model.md))
exige isolamento absoluto entre tenants. **Não é aceitável** que um bug
em qualquer query da API consiga retornar dados de outra organização.

A última linha de defesa precisa estar **no banco**, não na aplicação.

## Decisão

Habilitar **Row-Level Security (RLS)** em todas as tabelas que contenham
`organization_id` ou `store_id`.

### Roles de banco

Três roles Postgres distintos:

| Role             | Bypassa RLS? | Uso                                         |
| ---------------- | ------------ | ------------------------------------------- |
| `yugo_app`       | NÃO          | A API se conecta como este; respeita RLS.   |
| `yugo_admin`     | NÃO          | Idem, mas tem permissão de DDL controlada.  |
| `yugo_migrator`  | BYPASSRLS    | Apenas para `prisma migrate deploy`/seed.   |

`yugo_app` é dono dos `SELECT`/`INSERT`/`UPDATE` mas suas queries
sempre passam pelas policies.

### GUCs (settings de sessão) usados pelas policies

A API faz `SET LOCAL` no início de cada request autenticada:

```sql
SET LOCAL app.org_id   = '<uuid da org>';
SET LOCAL app.store_id = '<uuid da loja ativa>';
SET LOCAL app.user_id  = '<uuid do user>';
SET LOCAL app.role     = 'recepcao';            -- ou 'admin', 'owner', etc
SET LOCAL app.is_org_admin = 'true';            -- se role da org dá acesso a todas as lojas
```

Em requests não-autenticadas (health-check, login), nenhum desses é
setado e qualquer SELECT em tabela RLS retorna 0 rows.

### Padrão das policies

Para tabelas com `organization_id` E `store_id`:

```sql
-- leitura: organization deve bater + loja deve bater
-- (ou usuario eh admin da org, que ve todas as lojas dela)
CREATE POLICY tenant_read ON appointments
  FOR SELECT
  USING (
    organization_id = current_setting('app.org_id', true)::uuid
    AND (
      store_id = current_setting('app.store_id', true)::uuid
      OR current_setting('app.is_org_admin', true) = 'true'
    )
  );

-- escrita: sempre vinculada a uma loja
CREATE POLICY tenant_write ON appointments
  FOR ALL
  USING (
    organization_id = current_setting('app.org_id', true)::uuid
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.org_id', true)::uuid
    AND store_id = current_setting('app.store_id', true)::uuid
  );
```

Helpers em SQL (funções) facilitam manter consistência — vamos criá-las
no schema `app` (separado de `public`).

### Tabelas globais (sem RLS)

- `organizations`, `stores`, `users`: têm RLS mas só leitura filtrada
  por membership ativo.
- `roles` (default): leitura aberta; escrita só pra platform_admin.
- `intent_keywords` globais (sem `organization_id`): leitura aberta.
- `plans`, `billing`: só platform_admin.

### Testes obrigatórios

Toda PR que cria tabela com `organization_id` deve adicionar teste
de RLS em `packages/db/test/rls.test.sql`:

1. Conectar como `yugo_app`
2. `SET LOCAL app.org_id = '<org A>'`
3. `SELECT count(*) FROM tabela WHERE organization_id = '<org B>'`
4. Esperar `0`

CI roda esses testes; PR é bloqueada se algum falhar.

## Consequências

**Positivas:**
- Vazamento entre tenants vira impossível mesmo com bug na API.
- Auditoria de policies fica em um lugar único e versionada.
- Compliance LGPD fica mais defensável.

**Negativas:**
- API precisa de middleware obrigatório que `SET LOCAL` em toda request.
- Migrations precisam usar `yugo_migrator` (BYPASSRLS); senão `ALTER
  TABLE` em prod fica preso.
- Debugging fica mais difícil: `SELECT` que "não retorna nada" pode
  ser RLS bloqueando, não bug de query. Mitigação: log explícito do
  `app.org_id` setado em toda request.

## Quando relaxar

Apenas dois casos justificam desabilitar RLS:

1. **Workers de plataforma** (ex: job de billing cross-tenant). Usa
   `yugo_migrator` ou outro role BYPASSRLS, com audit_log obrigatório.
2. **Relatórios agregados anônimos** (DAU, MRR). Vista materializada
   feita por job da plataforma, sem PII.
