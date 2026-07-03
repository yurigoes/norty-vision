# yugo-platform

SaaS multi-tenant (multinível + multiloja) para **agenda**, **leads** e **disparador**,
reescrita do sistema legado em PHP/NocoDB rodando em `connect.yugochat.com.br`.

> Status: bootstrap. Estrutura ainda sendo montada — ver `docs/roadmap.md`.

## Princípios de segurança

- Senhas com **Argon2id** (PHC). Nunca bcrypt, nunca SHA puro.
- Sessões em cookies **httpOnly + Secure + SameSite=Strict**.
- JWT EdDSA assimétrico apenas serviço-a-serviço.
- **Row-Level Security** no Postgres por `organization_id` + `store_id`.
- Secrets via SOPS+age — `.env` apenas em desenvolvimento, nunca commitado.
- Audit log append-only de toda ação sensível.
- TLS 1.3 only, HSTS, CSP estrita, CORS allowlist, rate-limit Redis sliding window.

## Stack

| Camada           | Tecnologia                                         |
| ---------------- | -------------------------------------------------- |
| Frontend         | Next.js 15 (App Router) + TypeScript + Tailwind    |
| API              | NestJS + Prisma + Zod + Better-Auth                |
| Worker           | BullMQ                                             |
| Banco            | PostgreSQL 16 com RLS                              |
| Cache / Filas    | Redis 7                                            |
| Storage          | MinIO (S3-compatible)                              |
| Reverse proxy    | Caddy (TLS automático)                             |
| Monorepo         | pnpm workspaces + Turborepo                        |
| Runtime          | Node 22 LTS                                        |

## Estrutura

```
apps/
  web/             # Next.js (frontend administrativo + portal cliente)
  api/             # NestJS (REST + auth + RLS)
  worker/          # BullMQ (jobs D-3, disparos, NLU, agendamentos)
packages/
  db/              # Prisma schema + migrations + policies RLS + seed
  shared/          # tipos e schemas Zod compartilhados
  ui/              # design system (shadcn/ui customizado)
infra/
  docker/          # docker-compose.yml para dev + prod
  caddy/           # Caddyfile com HTTPS automático
  scripts/         # harden-vps, backup, restore, rotate-secrets
docs/
  adr/             # Architectural Decision Records
  roadmap.md
```

## Pré-requisitos (desenvolvimento)

- Node 22+ ([nvm](https://github.com/coreybutler/nvm-windows) no Windows)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop (Postgres, Redis, MinIO locais)
- Git

## Rodar local

```bash
# 1. Copiar template de env e preencher
cp .env.example .env

# 2. Instalar dependencias
pnpm install

# 3. Subir infra local (Postgres, Redis, MinIO)
pnpm docker:dev

# 4. Migrations e seed
pnpm db:migrate
pnpm db:seed

# 5. Subir tudo em modo dev
pnpm dev
```

Acesse:
- Frontend: http://localhost:3000
- API:      http://localhost:3001
- MinIO:    http://localhost:9001 (console)

## Deploy

VPS Debian 12 com Docker + Caddy. Ver `infra/scripts/harden-vps.sh` e
`docs/deploy.md` (em construção).

## Licença

Proprietária. Ver [`LICENSE`](./LICENSE).
