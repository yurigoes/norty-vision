# VoIP interno (Fase B.2) — ativação

**Ramais internos entre operadores** (WebRTC). Ligação ramal↔ramal **grátis**; discar
número real (PSTN) só na Fase C (trunk pago).

Há **dois modos**. O **padrão hoje é o P2P** (zero infra, zero portas) porque a produção
roda atrás de Cloudflare Tunnel/NAT, onde mídia UDP não passa. O modo FreeSWITCH fica
documentado como alternativa **só se você abrir portas** (IP público real).

---

## MODO PADRÃO — P2P (browser↔browser, mídia via Cloudflare TURN)

A ligação é **ponto-a-ponto entre os navegadores dos operadores**, sinalizada pela nossa
própria API (polling REST, passa pelo tunnel) e com a **mídia relayada pela Cloudflare
TURN** (grátis, 1 TB/mês). **Não precisa** de FreeSWITCH, coturn, DNS novo nem abrir porta.

### 1) Criar o TURN na Cloudflare
- Painel Cloudflare → **Calls / Realtime** → **TURN** → crie um app → anote **Turn Token ID**
  (Key ID) e a **API Token** (credencial).

### 2) Variáveis (.env.production)
```
CLOUDFLARE_TURN_KEY_ID=<Turn Token ID>
CLOUDFLARE_TURN_API_TOKEN=<API Token>
# opcional: self-host do Jitsi pra conferência (default meet.jit.si)
# JITSI_BASE_URL=https://meet.jit.si
```
A API gera credenciais TURN de curta duração sob demanda (cacheadas 12h). Sem essas
variáveis, cai em **STUN-only** (só funciona se os dois estiverem na mesma LAN/IP público).

### 3) Subir
Só o **deploy normal** — não há container novo:
```
git pull && bash infra/scripts/deploy-prod.sh
```
(ou reiniciar a API pra pegar as novas variáveis).

### 4) Como funciona no app
- Cada operador abre **Telefone** (`/app/voip`) e clica **Conectar**: a API cria o ramal
  automático e marca presença (`/api/voip/register`).
- A lista mostra os operadores **online** (bolinha verde); clica **Ligar** → liga **pelo nome**.
- Sinalização: `POST /api/voip/signal` + `GET /api/voip/poll` (offer/answer/bye/ringing/busy).
- Mídia: `RTCPeerConnection` direto entre os navegadores (relay Cloudflare TURN quando atrás de NAT).
- **Conferência:** botão abre a sala **Jitsi da empresa** (`yugo-conf-<orgId>`), multiponto grátis.
- Chamadas atendidas entram na **linha do tempo do lead** (`/api/voip/calls`).

> Não precisa de `VOIP_ENABLED`, DNS `voip.*`, nem regras de firewall neste modo.

---

## MODO ALTERNATIVO — FreeSWITCH (PABX real, exige ABRIR PORTAS)

Só vale a pena se a VPS tiver **IP público de verdade** (não CGNAT) e você puder abrir
portas UDP. Dá ramais SIP nativos, conferência no servidor e caminho pro PSTN (Fase C).
Os arquivos (`docker-compose.voip.yml`, `coturn/`, `freeswitch/`) já estão no repo e ficam
**dormentes** até `VOIP_ENABLED=1`. O código da API mantém os endpoints `mod_xml_curl`
(`/api/voip/fs/xml`) prontos.

### 1) DNS + Caddy (sinalização WSS)
- DNS **voip.yugochat.com.br** → VPS (Cloudflare). No Caddyfile: `voip.yugochat.com.br { reverse_proxy 127.0.0.1:7443 }`.

### 2) Variáveis (.env.production)
```
VOIP_ENABLED=1
VOIP_WS_HOST=voip.yugochat.com.br
VOIP_SIP_DOMAIN=voip.yugochat.com.br
VOIP_TURN_HOST=voip.yugochat.com.br
VOIP_TURN_USER=yugo
VOIP_TURN_PASS=<senha forte; a MESMA do turnserver.conf>
VOIP_FS_SECRET=<segredo; o MESMO do xml_curl.conf.xml>
```
> ⚠️ Neste modo seria preciso um softphone SIP (o cliente atual é P2P, não JsSIP). Use só
> se for migrar a stack pra ter IP público — caso contrário fique no modo P2P.

### 3) FreeSWITCH (overrides) / 4) Firewall UDP
- Overrides em `infra/voip/freeswitch` (xml_curl → `http://127.0.0.1:3001/api/voip/fs/xml`,
  wss-binding `:7443`, ws-binding `:5066`, `external_rtp_ip`/`external_sip_ip` = IP público,
  RTP 16384–32768).
- Firewall: **16384–32768/udp** (RTP), **3478/udp+tcp** + **49152–65535/udp** (coturn),
  **7443/tcp** (WSS atrás do Caddy).

### 5) Subir
Com `VOIP_ENABLED=1`, o `deploy-prod.sh` inclui o overlay automaticamente. Ou manual:
```
docker compose -f infra/docker/docker-compose.prod.yml -f infra/docker/docker-compose.voip.yml up -d freeswitch coturn
```

---

## Gravação (depois)
Gravar no navegador (P2P) ou no FreeSWITCH → arquivo → enviar pro **Google Drive** (camada
da §13 do desenho), nunca encher o disco da VPS.
