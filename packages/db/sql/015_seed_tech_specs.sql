-- ==============================================================================
-- 015_seed_tech_specs.sql
-- Conteudo inicial da aba "Specs Tecnicas" (acesso restrito).
-- ==============================================================================

INSERT INTO tech_spec_documents (slug, category, title, summary, body_markdown, display_order)
VALUES
  ('stack', 'arquitetura', 'Stack tecnologico',
   'Linguagens, frameworks, banco e infra usados no yugo-platform.',
   $$
# Stack tecnologico

## Linguagem principal

**TypeScript 5.7+** em todo o codigo (frontend, backend, worker, scripts).

## Frontend

| Camada              | Tecnologia                               |
| ------------------- | ---------------------------------------- |
| Framework           | Next.js 15 (App Router)                  |
| UI                  | Tailwind CSS 3 + shadcn/ui               |
| Estado server       | TanStack Query 5                         |
| Estado local        | Zustand (quando preciso de global)       |
| Formularios         | React Hook Form + Zod                    |
| Datas               | date-fns 3                               |
| Renderizacao        | RSC por padrao; Client Components onde precisa de interatividade |

## Backend

| Camada              | Tecnologia                               |
| ------------------- | ---------------------------------------- |
| Framework           | NestJS 10 + Fastify adapter              |
| Validacao           | Zod (boundaries) + class-validator (DTOs internos) |
| ORM                 | Prisma 6 (gerado a partir do schema SQL) |
| Auth                | Better-Auth (sessao httpOnly)            |
| Filas               | BullMQ 5                                 |
| Pagamentos          | Mercado Pago (existente, mantido)        |
| WhatsApp            | Evolution API (existente)                |

## Worker

NestJS standalone (sem HTTP) com BullMQ consumindo:
- `reminders` - lembretes D-3 de agendamento
- `messaging` - envio de WhatsApp/SMS
- `campaigns` - rate-limited dispatch de campanhas
- `nlu` - classificacao de mensagens inbound
- `audit_partitions` - cria particoes mensais de audit_log

## Banco

| Camada              | Tecnologia                               |
| ------------------- | ---------------------------------------- |
| RDBMS               | PostgreSQL 16 (bookworm container)       |
| Extensoes           | pgcrypto, citext, pg_trgm, btree_gin, unaccent |
| Isolamento          | Row-Level Security (RLS) em todas as tabelas com `organization_id` |
| Migrations          | SQL puro versionado em `packages/db/sql/` (fonte da verdade); Prisma gera client |
| Backup              | pg_dump cifrado (age) para MinIO diario  |

## Cache / Filas

**Redis 7-alpine** com AOF persistido, senha obrigatoria, maxmemory LRU.

## Storage

**MinIO** (S3-compatible). Bucket `yugo-platform`. Acesso interno apenas.

## Reverse proxy / TLS

**Caddy 2.8-alpine**.
- TLS 1.3 obrigatorio
- TLS automatico via Let's Encrypt
- HTTP/3 (QUIC) habilitado
- Path routing: `/api/*` -> NestJS, resto -> Next.js

## Containerizacao

- `docker-compose.prod.yml` na VPS
- 5 servicos: caddy, postgres, redis, minio, minio-init (boot one-shot)
- Networks: `yugo-edge` (caddy externo) + `yugo-internal` (servicos)

## Versoes Node / pnpm

- Node 22 LTS
- pnpm 9+
- Turborepo 2 para build/cache do monorepo
$$,
   10),

  ('seguranca', 'seguranca', 'Modelo de seguranca',
   'Hashing, criptografia, controle de acesso, RLS e politicas operacionais.',
   $$
# Modelo de seguranca

## Hashing e criptografia

| Uso                          | Algoritmo            | Detalhe                          |
| ---------------------------- | -------------------- | -------------------------------- |
| Senhas de usuario            | **Argon2id**         | PHC string; rehash em login se parametros mudaram |
| Tokens de sessao             | random 256 bits + sha256 storage | raw soh no cookie httpOnly |
| JWT service-to-service       | **EdDSA (Ed25519)**  | chaves rotacionadas trimestralmente |
| TLS                          | TLS 1.3              | Let's Encrypt 60-dias            |
| SSH                          | **Ed25519**          | sem RSA                          |
| Dados em repouso (PII)       | AES-256-GCM          | quando exportado/exportavel      |
| Secrets de deploy            | **age** (X25519) ou Doppler | em SOPS-encrypted YAML  |
| Hash de auditoria            | SHA-256              |                                  |
| MFA TOTP                     | RFC 6238 SHA1 30s    | obrigatorio pra platform_admin   |

## Cookies

```
Set-Cookie: yugo_session=<token>;
  Path=/;
  Domain=yugochat.com.br;
  HttpOnly;
  Secure;
  SameSite=Strict;
  Max-Age=2592000
```

## Headers HTTP (Caddy)

- Strict-Transport-Security: 2 anos + preload
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Content-Security-Policy: default-src 'self' (apertada quando app subir)
- Cross-Origin-Opener-Policy: same-origin
- Permissions-Policy: bloqueia geo/mic/cam/payment

## RLS (multi-tenant)

Ver `docs/adr/0002-rls-strategy.md`. Resumo:

- 3 roles Postgres: `yugo_app` (respeita RLS), `yugo_migrator` (BYPASSRLS, soh pra DDL).
- Toda request da API faz `SET LOCAL app.org_id`, `app.store_id`, `app.user_id`,
  `app.role`, `app.is_org_admin` antes de qualquer query.
- Sem esses settings, qualquer SELECT em tabela com RLS retorna 0 rows.

## Hardening do servidor

- UFW: deny incoming por default, libera apenas 22/80/443 + RustDesk (21115-21119).
- fail2ban: jail SSH (maxretry=3, bantime=24h).
- SSH: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, Ed25519 obrigatorio.
- unattended-upgrades: patches de seguranca automaticos.
- sysctl: tcp_syncookies, fs.protected_*, kernel.dmesg_restrict, etc.

## Auditoria

- `audit_log` particionado por mes; append-only (trigger bloqueia UPDATE/DELETE).
- `data_access_log` para trail LGPD (quem visualizou dados pessoais quando).
- `tech_spec_access_log` para trail desta aba.

## Rate limiting

- Caddy: rate limit por IP em rotas sensiveis (/api/auth/*).
- Redis sliding window por user_id pra evitar abuso autenticado.

## Backup e restore

- Postgres: pg_dump diario as 03h BRT, cifrado com `age`, enviado pra MinIO.
- Retencao 30 dias.
- Restore testado trimestralmente em ambiente staging.

## Secrets

- `.env.production` na VPS, modo 600, owner root.
- Backup do arquivo em gerenciador de senhas do master.
- Gerado por `generate-secrets.sh` com `openssl rand -base64 48` (48 chars).
$$,
   20),

  ('infra', 'infra', 'Infraestrutura',
   'Onde tudo roda, topologia de rede, backups, monitoring.',
   $$
# Infraestrutura

## VPS de producao

- **Provider**: (preenchido pelo dono)
- **IP**: 178.105.111.15
- **Hostname**: rustdesk (compartilha com servidor RustDesk self-hosted)
- **OS**: Debian 12 (Bookworm)
- **Specs**: 2 vCPU / 3.7 GiB RAM / ~38 GiB disco

## Topologia

```
                  [Internet]
                       |
                  [443 / 80]
                       |
                  +--------+
                  | Caddy  |  yugo-edge network
                  +--------+
                       |     (proxy interno)
                  yugo-internal network
            +----------+----------+----------+
            |          |          |          |
        Postgres    Redis      MinIO      NestJS API
        (5432)     (6379)    (9000)      (3001)
                                              |
                                          Next.js
                                          (3000)
                                              |
                                          Worker
                                          (BullMQ)
```

## Servicos coabitando na mesma VPS

- yugo-platform (Caddy, Postgres, Redis, MinIO + futuro app/api/worker)
- RustDesk server (hbbs, hbbr nas portas 21115-21119)

UFW libera tanto 22/80/443 quanto as portas do RustDesk.

## DNS

- `yugochat.com.br` apex -> 178.105.111.15 (esta VPS)
- registro AAAA antigo apontando pra 2a02:4780:84::32 (legado, **remover**)

## CI/CD

GitHub Actions (a configurar):
- Lint + typecheck + test em todo push
- Build de container em main
- Deploy automatico via SSH pra VPS quando tag

## Monitoramento

(planejado)
- Pino logs estruturados -> stdout dos containers
- Loki para agregacao (futuro)
- Sentry para erros de aplicacao
- Uptime monitoring externo
$$,
   30),

  ('dados', 'dados', 'Modelo de dados',
   'Como o schema esta organizado, conceitos centrais.',
   $$
# Modelo de dados

Ver tambem `docs/adr/0001-multi-tenancy-model.md`.

## Hierarquia

```
organizations
  +-> stores
       +-> memberships (user x role)
       +-> customers
       +-> professionals
       +-> schedule_slots
       +-> appointments
       +-> leads
       +-> campaigns
       +-> message_log
```

## Tabelas centrais

| Tabela                | Funcao                                          |
| --------------------- | ----------------------------------------------- |
| organizations         | Cliente master                                  |
| stores                | Filial                                          |
| users                 | Credencial humana                               |
| roles                 | Templates de permissao (owner, admin, ...)      |
| memberships           | User x Store x Role                             |
| sessions              | Cookies httpOnly                                |
| customers             | Pacientes/clientes finais                       |
| professionals         | Quem atende                                     |
| schedule_templates    | Modelo semanal de slots                         |
| schedule_slots        | Horarios concretos                              |
| appointments          | Agendamento individual                          |
| appointment_events    | Timeline imutavel                               |
| intent_keywords       | Regras NLU configuravel                         |
| message_log           | Inbound/Outbound unificado                      |
| unresolved_replies    | Fila revisao humana                             |
| lead_pipelines        | Kanban configuravel                             |
| leads                 | Oportunidade comercial                          |
| campaigns             | Disparos em massa                               |
| audit_log             | Trail de acoes sensiveis (particionado/mes)     |
| help_articles         | Aba Ajuda                                       |
| system_guide_sections | Aba Guia                                        |
| tech_spec_documents   | Esta aba                                        |

## ID strategy

- `uuid` (gen_random_uuid v4) em todas as tabelas de negocio.
- `bigserial` em logs/eventos (high-write append-only).
- `short_code` Base32 (8 chars) em appointments para URLs publicas curtas
  (`yugochat.com.br/confirm/AB12CDEF`).
- Migracao futura: UUIDv7 quando passar de ~1M rows/tabela.

## Schema-as-code

Arquivos `.sql` em `packages/db/sql/` sao **a fonte da verdade**.
Prisma `db pull` gera o client a partir do banco depois das migrations.

Ordem de execucao lexicografica: 000_ a 099_seed_*.
Todos idempotentes (IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE).
$$,
   40),

  ('integracoes', 'integracoes', 'Integracoes externas',
   'WhatsApp, pagamentos, NLU fallback.',
   $$
# Integracoes externas

## Evolution API (WhatsApp Business)

- Inbound: webhook recebe mensagens recebidas no numero da loja, registra
  em `message_log`, passa pelo pipeline NLU, atualiza estado de appointment se aplicavel.
- Outbound: API REST chama o endpoint da Evolution pra enviar.
- Multi-numero: cada loja pode ter sua instancia (`stores.whatsapp_instance_id`).

## Mercado Pago

- Mantido do legado.
- Pagamentos PIX, cartao, pinpad (cardapio).
- Webhook `/api/cardapio/mercadopago/webhook` (a migrar).

## Anthropic Claude (NLU fallback)

- Modelo: `claude-haiku-4-5-20251001`
- Uso: classificar mensagens que nao caem em nenhuma keyword.
- Custo estimado: $0.001 por classificacao.
- Cache (Redis) de classificacoes recentes pra reduzir custo.

## n8n (legado)

- Existe em outra VPS. Sera **gradualmente substituido** pelo worker proprio
  conforme cada fluxo migra.
$$,
   50),

  ('deploys', 'infra', 'Deploys e operacoes',
   'Como subir nova versao, rollback, manutencao.',
   $$
# Deploys e operacoes

## Deploy de nova versao

```bash
ssh yugo-vps-root
cd /opt/yugo-platform
bash infra/scripts/deploy-prod.sh
```

O script:
1. `git pull` (a menos que --no-pull)
2. valida .env.production (sem CHANGE_ME)
3. `docker compose pull` (imagens novas)
4. `docker compose up -d` (recria mudou)
5. health-check de cada container
6. smoke test em https://yugochat.com.br/health

## Rollback rapido

```bash
cd /opt/yugo-platform
git log --oneline -5             # ver commits recentes
git checkout <sha-anterior>      # ou git revert
bash infra/scripts/deploy-prod.sh --no-pull
```

## Manutencao do banco

```bash
# backup manual
docker exec yugo-postgres pg_dump -U yugo yugo | age -e -r <pubkey> > backup.age

# restore
age -d -i ~/.config/sops/age/key.txt backup.age | docker exec -i yugo-postgres psql -U yugo yugo
```

## Adicionar nova migration SQL

1. Criar `packages/db/sql/0XX_<descricao>.sql` (idempotente!)
2. Commit + push
3. Na VPS: `git pull` e aplicar via `psql -U yugo_migrator -d yugo -f /sql/0XX_*.sql`

## Rotacionar secrets

```bash
cd /opt/yugo-platform/infra/scripts
./generate-secrets.sh --force
docker compose -f ../docker/docker-compose.prod.yml --env-file ../docker/.env.production up -d
```
$$,
   60)
ON CONFLICT (slug) DO UPDATE SET
  title         = EXCLUDED.title,
  summary       = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  display_order = EXCLUDED.display_order,
  version       = tech_spec_documents.version + 1,
  updated_at    = now();
