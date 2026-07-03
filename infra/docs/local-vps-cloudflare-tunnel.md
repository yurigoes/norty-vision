# Instalacao em VPS local com Cloudflare Tunnel (auto-provisionada)

Sobe a yugo-platform numa VPS local exposta via Cloudflare Tunnel. A VPS faz
**todo** o trabalho do Cloudflare via API: cria o tunnel, configura o
ingress, cria os CNAMEs. Voce so entrega 3 IDs/tokens.

## Pre-requisitos

- VPS Debian 12 (qualquer cloud, ou maquina fisica)
- Conta Cloudflare (free)
- Conta Hostinger (ou outro registrar) gerenciando `yugochat.com.br`

---

## Passo 1 — Cloudflare: criar zona delegada (uma vez so)

Vamos usar `local.yugochat.com.br` como zona da Cloudflare. O resto do
`yugochat.com.br` continua na Hostinger, intocado.

1. https://dash.cloudflare.com → **Add a Site** → digite
   `local.yugochat.com.br`
2. Plano Free → Continue
3. Cloudflare mostra 2 nameservers (ex: `bob.ns.cloudflare.com`,
   `alice.ns.cloudflare.com`). **Anote.**
4. Na **Hostinger**, em DNS de `yugochat.com.br`, crie 2 records NS:

   ```
   local.yugochat.com.br   NS   bob.ns.cloudflare.com
   local.yugochat.com.br   NS   alice.ns.cloudflare.com
   ```

5. Volte na Cloudflare e clique **Done, check nameservers**. Aguarde ate a
   zona virar **Active** (geralmente <30min).

> Nenhum DNS atual da Hostinger e tocado. Apenas 2 records NS adicionados.

---

## Passo 2 — Cloudflare: pegar 3 valores

Voce vai precisar de:

### 2.1 — Zone ID

- Na zona `local.yugochat.com.br`, aba **Overview** → no canto direito,
  **API → Zone ID**. Copie.

### 2.2 — Account ID

- Mesmo lugar, **API → Account ID**. Copie.

### 2.3 — API Token (escopo limitado)

- https://dash.cloudflare.com → **My Profile** → **API Tokens** → **Create Token**
- Escolha **Create Custom Token**:
  - Token name: `yugo-tunnel-bootstrap`
  - Permissions:
    - `Account` > `Cloudflare Tunnel` : `Edit`
    - `Zone` > `DNS` : `Edit`
  - Account Resources: **Include** > seu account
  - Zone Resources: **Include** > **Specific zone** > `local.yugochat.com.br`
  - TTL: opcional (ex: 90 dias)
- **Continue → Create Token** → copie o token (so aparece 1 vez).

---

## Passo 3 — Rodar o instalador na VPS local

### Modo A: nova zona (sem produção rodando)

```bash
curl -fsSL https://raw.githubusercontent.com/yurigoes/yugo-platform/main/infra/scripts/install-local-vps.sh \
  -o /tmp/install.sh

CF_API_TOKEN='COLE_AQUI' \
CF_ACCOUNT_ID='COLE_AQUI' \
CF_ZONE_ID='COLE_AQUI' \
TUNNEL_BASE_DOMAIN='yugochat.com.br' \
sudo -E bash /tmp/install.sh
```

O script cria tunnel + CNAMEs (apex `@` + www) e tudo entra no ar de imediato.

### Modo B: migrar producao existente sem downtime

Quando ja tem A records apontando pra outra VPS e voce vai migrar:

```bash
SKIP_DNS=1 \
TUNNEL_HOSTNAMES='@ www chatwoot chamados evo' \
WITH_SERVICES=1 \
CF_API_TOKEN='...' CF_ACCOUNT_ID='...' CF_ZONE_ID='...' \
TUNNEL_BASE_DOMAIN='yugochat.com.br' \
sudo -E bash /tmp/install.sh
```

`SKIP_DNS=1` cria o tunnel e configura o ingress, mas **nao toca no DNS**.
A producao continua nos A records antigos. Depois de migrar os dados:

```bash
DRY_RUN=1 \
TUNNEL_HOSTNAMES='@ www chatwoot chamados evo' \
CF_API_TOKEN='...' CF_ACCOUNT_ID='...' CF_ZONE_ID='...' \
TUNNEL_BASE_DOMAIN='yugochat.com.br' \
bash /opt/yugo-platform/infra/scripts/cloudflare-tunnel-cutover.sh

# se o dry-run mostrar o esperado, rode sem DRY_RUN=1
```

O cutover deleta os A records antigos e cria CNAMEs proxied pro tunnel.
Propagacao tipica: 1-5 minutos.

Para tambem subir chatwoot + glpi + evolution na VPS local (e criar CNAMEs
deles automaticamente):

```bash
WITH_SERVICES=1 \
CF_API_TOKEN='...' CF_ACCOUNT_ID='...' CF_ZONE_ID='...' \
TUNNEL_BASE_DOMAIN='local.yugochat.com.br' \
sudo -E bash /tmp/install.sh
```

### O que o script faz

1. Instala pacotes base (Docker, UFW, git, jq, etc).
2. UFW permite **so** SSH — tunnel sai do container, nao precisa abrir 443.
3. Clona o repo em `/opt/yugo-platform`.
4. **Chama a API Cloudflare** e:
   - Cria (ou reusa) o tunnel `yugo-local`
   - Configura ingress: `app.local.yugochat.com.br` → `http://yugo-caddy:80` (etc)
   - Cria/atualiza CNAMEs proxied
   - Pega o connector token
5. Gera `.env.production` com secrets aleatorios + injeta o token.
6. Builda as imagens `yugo/api` e `yugo/web`.
7. Sobe a stack (prod + tunnel overlay).
8. Aplica migrations SQL.

Tudo idempotente — rode de novo se quiser que o script reconcilie estado.

---

## Passo 4 — Verificar

No painel Cloudflare:

- **Zero Trust → Networks → Tunnels** → o tunnel `yugo-local` deve estar **HEALTHY**.
- **Public Hostnames** do tunnel deve listar os hostnames criados.
- DNS da zona `local.yugochat.com.br` deve mostrar CNAMEs proxied (ícone laranja).

Na VPS:

```bash
cd /opt/yugo-platform/infra/docker
docker compose \
  -f docker-compose.prod.yml -f docker-compose.tunnel.yml \
  --env-file .env.production ps
```

Todos containers `Up (healthy)`.

```bash
docker logs -f yugo-cloudflared
```

Procure por `Registered tunnel connection` (geralmente 4x — 4 locais de PoP).

No navegador: `https://app.local.yugochat.com.br` — deve abrir a landing.

---

## Importar dados do legacy (NocoDB)

Apos a stack estar de pe e voce ter criado uma org no painel master, voce
pode importar dados do sistema antigo:

1. **Export do legacy**: customers, appointments, leads, campaigns
   (CSV ou JSON).
2. **Copie pro repo da VPS**:
   ```bash
   mkdir -p /opt/yugo-platform/imports/<empresa>
   scp arquivos vps:/opt/yugo-platform/imports/<empresa>/
   ```
3. **Importe**:
   - **A) SQL direto** (rapido pra volume grande):
     ```bash
     docker exec -i yugo-postgres psql -U yugo yugo < /opt/yugo-platform/imports/<empresa>/import.sql
     ```
     O SQL deve ter `INSERT INTO customers(... organization_id, store_id ...)`
     com os UUIDs corretos da org/store.
   - **B) Via API** (mais validado):
     - Loga como owner da empresa, faz POST em `/api/customers`, etc.
     - Disponivel quando essas rotas estiverem prontas (Fase F).

> Quando voce me mandar o formato do dump (1 linha de exemplo por tabela),
> monto um script de import customizado que respeita RLS e mapeia campos.

---

## Voltar pro modo VPS publica (sem tunnel)

Se um dia quiser que a VPS local responda direto (sem CF Tunnel), **nao** passe
`-f docker-compose.tunnel.yml`:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Caddy volta a expor 80/443 e tira cert Let's Encrypt como em producao.

---

## Re-rodar o instalador (idempotente)

Pode rodar o script novamente a qualquer momento — ele:

- Nao re-instala pacotes ja presentes
- Da `git pull` (nao re-clona)
- **Preserva** `.env.production` existente (so atualiza CLOUDFLARED_TOKEN)
- Reusa tunnel existente (mesmo nome), so atualiza ingress/DNS
- Re-builda imagens (Docker cache mantem rapido)
- Faz `up -d` (re-cria containers se config mudou)

Util quando voce adicionar/remover hostnames ou trocar de servidor.

---

## Wildcard por empresa (`*.yugochat.com.br`)

Cada empresa tem seu subdominio (ex.: `zitooticas.yugochat.com.br`) servindo a
vitrine/landing da loja com o branding dela. Isso depende de um **CNAME wildcard
proxied** + uma **regra de ingress wildcard** apontando pro Caddy. O Caddy ja
encaminha qualquer Host pro Next.js preservando o header; o middleware do app
reescreve `<slug>.<base>/` -> `/empresa/<slug>`.

O instalador (`install-local-vps.sh`) e o `cloudflare-tunnel-provision.sh` ja
ligam o wildcard por padrao (`WITH_WILDCARD=1`).

Pra ligar **somente o wildcard** num tunnel que ja esta em producao, sem mexer
no resto do ingress (chatwoot/chamados/evo), rode na VPS:

```bash
CF_API_TOKEN=...  CF_ACCOUNT_ID=...  CF_ZONE_ID=...  \
TUNNEL_BASE_DOMAIN=yugochat.com.br  TUNNEL_NAME=yugo-local  \
bash infra/scripts/cloudflare-tunnel-wildcard.sh
```

O script e idempotente e nao-destrutivo: le o ingress atual, insere a regra
`*.<base>` logo antes do catch-all (404) e cria/atualiza o CNAME wildcard.
