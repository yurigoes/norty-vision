# Deploy — Norty Vision (VPS local + Cloudflare Tunnel)

Stack **autocontido** que roda na **mesma VPS local do yugo** sem colidir:
containers `nv-*`, redes `norty-*`, volumes `norty-*`, **Postgres/Redis/MinIO
próprios** e **cloudflared próprio**. Nunca publica 80/443 no host (só tunnel).

Arquivos:
- `infra/docker/docker-compose.norty.yml` — stack completo.
- `infra/caddy/Caddyfile.norty` — roteamento tunnel-mode (apex + slugs).
- `infra/docker/.env.norty.example` — template de env.
- `infra/scripts/norty-generate-secrets.sh` — gera `.env.norty`.
- `infra/scripts/norty-db-apply.sh` — cria DB `norty_vision` + schema.
- `infra/scripts/norty-create-master.sh` — cria o master.

## Pré-requisitos (BLOQUEIOS externos)

1. **DNS na zona `norty.com.br`** (Cloudflare): `vision.norty.com.br` **e**
   wildcard `*.vision.norty.com.br` apontando pro tunnel.
   > ⚠️ Ainda **não temos token DNS do norty salvo** — este passo depende de
   > acesso ao Cloudflare da zona norty.com.br.
2. **Cloudflare Tunnel** (Zero Trust → Networks → Tunnels): criar um tunnel
   próprio do Norty Vision e, na aba *Public Hostname*, mapear:
   - `vision.norty.com.br` → `http://nv-caddy:80`
   - `*.vision.norty.com.br` → `http://nv-caddy:80`
   Copiar o **token** do tunnel pra `NORTY_CLOUDFLARED_TOKEN`.

## Passo a passo (na VPS)

```bash
# 0) clonar o repo (uma vez)
sudo git clone https://github.com/yurigoes/norty-vision /opt/norty-vision
cd /opt/norty-vision/infra/docker

# 1) segredos
DOMAIN=vision.norty.com.br ../scripts/norty-generate-secrets.sh
#   -> edite .env.norty: preencha NORTY_CLOUDFLARED_TOKEN
#   -> anote NORTY_LICENSE_TOKEN (vai no Norty → Sistemas → Gerenciar)

# 2) sobe só os dados primeiro
docker compose -f docker-compose.norty.yml --env-file .env.norty up -d \
  nv-postgres nv-redis nv-minio nv-minio-init

# 3) cria banco + aplica schema (packages/db/sql)
bash ../scripts/norty-db-apply.sh

# 4) build + sobe API/Web/Caddy/Cloudflared
docker compose -f docker-compose.norty.yml --env-file .env.norty up -d --build

# 5) cria o master (senha digitada, não ecoa)
bash ../scripts/norty-create-master.sh

# health
docker compose -f docker-compose.norty.yml ps
curl -s -H 'Host: vision.norty.com.br' http://127.0.0.1/health   # via nv-caddy
```

> Se o build da API/Web bater no erro de TLS do `docker/dockerfile:1.7`
> (Docker Hub instável), pré-puxe a imagem antes do `--build`:
> `for i in 1 2 3 4 5; do docker pull docker/dockerfile:1.7 && break; sleep 5; done`

## Branding in-app

O nome/logo do sistema no app vêm de `platform_settings` no banco (não do
código). Depois do deploy, ajuste em **Master → Identidade & Branding**:
- Nome do produto: **Norty Vision**
- Logo: subir `apps/web/public/brand/norty-vision.png` (e o `-n-branco` pro dark)

Ou via SQL no `nv-postgres` (DB `norty_vision`):

```sql
UPDATE platform_settings
   SET product_name = 'Norty Vision'
 WHERE id = (SELECT id FROM platform_settings ORDER BY created_at LIMIT 1);
```

## API de licenciamento (Norty → Sistemas → Gerenciar)

- Base URL: `https://vision.norty.com.br/api/norty/v1`
- Token (Bearer): valor de `NORTY_LICENSE_TOKEN` no `.env.norty`
- Endpoints: `GET /me`, `POST /licenses`, `GET /licenses/:id`,
  `POST /licenses/:id/{suspend|reactivate|cancel}`, `GET /plans`.

## Migração de dados do `zito-oticas` (do yugo → Norty Vision)

Pendente e feita à parte (precisa acesso ao Postgres do yugo). Alvo principal:
**ponto eletrônico + assinaturas de folha** do slug `zito-oticas`. Estratégia:
`pg_dump` filtrado por `org_id` do zito no `yugo-postgres` → `pg_restore` no
`nv-postgres`/`norty_vision`, remapeando IDs de org. Documentar em migração
separada quando o acesso ao banco estiver disponível.

## Operação

```bash
# logs
docker logs -f nv-api
docker logs -f nv-cloudflared

# atualizar (novo código)
cd /opt/norty-vision && git pull
docker compose -f infra/docker/docker-compose.norty.yml --env-file infra/docker/.env.norty up -d --build

# aplicar novas migrations
bash infra/scripts/norty-db-apply.sh
```
