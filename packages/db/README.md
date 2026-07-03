# `@yugo/db` — schema, migrations e policies RLS

Esta package contém:

- `sql/` — schema SQL puro versionado (fonte da verdade).
- `prisma/` — schema Prisma gerado a partir do SQL (em construção).
- `test/` — testes de RLS (em construção).

## Ordem de execução das migrations

Os arquivos em `sql/` rodam em ordem **lexicográfica**. Convencão:

```
000_roles.sql              # roles do Postgres (yugo_app, yugo_migrator) - 1x
001_extensions.sql         # extensoes + schema 'app' + helpers
002_tenancy.sql            # orgs, stores, users, memberships, roles, sessions
003_seed_roles.sql         # seed dos roles templates (owner, admin, ...)
004_rls_tenancy.sql        # policies RLS de tenancy
00x_*                      # proximas etapas: catalog, scheduling, NLU, leads, campaigns, audit
```

Cada arquivo é **idempotente** — pode rodar várias vezes sem efeito
colateral (usa `IF NOT EXISTS`, `DROP POLICY IF EXISTS ... CREATE
POLICY`, etc).

## Rodar localmente (dev)

Com o docker-compose de dev (a criar):

```bash
pnpm db:reset      # drop + recreate banco
pnpm db:migrate    # roda todos os .sql em ordem
pnpm db:seed       # popula dados de exemplo
```

## Rodar em produção

`yugo_migrator` é o **único** role que pode rodar migrations (tem
BYPASSRLS). Senha é gerada por `generate-secrets.sh` e armazenada
em `.env.production` (gitignored).

```bash
docker compose exec postgres psql -U yugo_migrator -d yugo \
  -v ON_ERROR_STOP=1 -f /sql/001_extensions.sql
```

## Princípios

1. **Schema é a verdade.** Prisma `generate` lê o banco real depois das
   migrations, não o contrário. Evitar `prisma db push` em prod.
2. **RLS sempre.** Toda tabela com `organization_id` ganha policy. Sem
   exceção. Ver [ADR 0002](../../docs/adr/0002-rls-strategy.md).
3. **Soft delete via `deleted_at`** em tabelas de longa vida. Hard delete
   apenas para dados temporários (sessions, jobs).
4. **Timestamps via trigger** (`tg_set_updated_at`), não pela app.
5. **IDs via `app.new_id()`** (ver [ADR 0003](../../docs/adr/0003-uuid-primary-keys.md)).
