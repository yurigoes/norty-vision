# PABX externo — Asterisk (substitui FreeSWITCH)

Sobe **Asterisk + coturn + Caddy** numa VPS com **IPv4 público**. Substituto do
FreeSWITCH/safarov: Asterisk + chan_pjsip + res_http_websocket tem suporte
WebSocket SIP nativo e maduro pra softphones JsSIP no navegador.

> Ativação **assistida**: configuração mínima testada; ajustes finos vêm no
> 1º teste de voz.

## Pré-requisitos
1. **VPS com IPv4 público** (não CGNAT). `curl -4 ifconfig.me` tem que bater
   com o IP que o provedor te deu, alcançável de fora.
2. **DNS**: `voip.<seu-dominio>` como **A** apontando pro IP, **DNS only**
   (nuvem cinza no Cloudflare).
3. `docker`, `docker compose v2`, `jq`, `curl` no host.

## Instalação

### A) Levar os arquivos pra VPS (repo PRIVADO, sem chave/sem token)
Do seu PC, via scp:
```powershell
scp -P 2222 -r "A:\yugochat\yugo-platform\infra\voip\asterisk-vps" root@<IP>:/opt/pabx-asterisk
```

### B) Configurar + subir
```bash
ssh -p 2222 root@<IP>
cd /opt/pabx-asterisk
cp .env.example .env
nano .env   # preencher VOIP_DOMAIN, PUBLIC_IP, API_URL, VOIP_FS_SECRET, TURN_USER/PASS
bash setup.sh
```

O `setup.sh`:
- gera os configs (`generated/asterisk-etc/`, `generated/coturn/`)
- instala cron a cada 30s do `sync-config.sh`
- abre UFW (80, 443, 5060, 3478, 5349, 10000-20000/udp, 49152-65535/udp)
- pulla a imagem Asterisk
- puxa os ramais/trunks da API uma vez e sobe os containers

### C) Aplicar no yugo (VPS local)
No `.env.production` do yugo:
```
VOIP_SIP_WS_URL=wss://voip.<seu-dominio>/ws
VOIP_SIP_DOMAIN=voip.<seu-dominio>
VOIP_FS_SECRET=<o mesmo do PABX>
VOIP_TURN_HOST=voip.<seu-dominio>
VOIP_TURN_USER=yugo
VOIP_TURN_PASS=<o mesmo do PABX>
```
⚠️ A URL do WS **agora tem o path `/ws`** (Asterisk expõe lá, diferente do FS).
Restart a api: `docker compose ... up -d --force-recreate api`.

## Verificar saúde do Asterisk
```bash
# Endpoints (ramais) configurados via sync
docker exec yugo-asterisk asterisk -rx 'pjsip show endpoints'

# Trunks registrados na operadora
docker exec yugo-asterisk asterisk -rx 'pjsip show registrations'

# Contatos ativos (ramais conectados)
docker exec yugo-asterisk asterisk -rx 'pjsip show contacts'

# Transports
docker exec yugo-asterisk asterisk -rx 'pjsip show transports'

# Status do HTTP server (deve estar Listening on 0.0.0.0:8088)
docker exec yugo-asterisk asterisk -rx 'http show status'
```

## Como funciona
- **HTTP/WS**: Asterisk expõe `:8088`. Caddy proxy `wss://voip.<dom>/ws` → `127.0.0.1:8088/ws`.
- **Auth dos ramais**: o `sync-config.sh` (cron 30s) faz GET em
  `${API_URL}/api/voip/asterisk/config?secret=...`, recebe JSON com ramais+trunks
  da nossa DB, gera `pjsip_dynamic.conf`, e dá `pjsip reload`.
- **Dialplan**: `extensions.conf` rota interna (1000-9999) → ramal; PSTN (8+
  dígitos) → trunk; inbound do trunk (sobreip) → toca ramal 1001 (provisório).
- **Mídia (WebRTC)**: `webrtc=yes` nos endpoints liga ICE/DTLS/RTCP-mux; coturn
  ajuda na travessia de NAT do operador.

## Migração do FreeSWITCH (se tiver rodando)
Antes de subir Asterisk, para o FS:
```bash
cd /opt/pabx
docker compose down
crontab -l 2>/dev/null | grep -v 'sync-gateways.sh' | crontab -   # remove cron antigo
cd ..
```
Depois roda o setup do asterisk-vps. Pode manter o backup `/opt/pabx` por
segurança (`mv /opt/pabx /opt/pabx.bak.fs`).

## Gravação (depois)
Asterisk grava via `Monitor()` ou `MixMonitor()` no dialplan. Próximo passo é
enviar pro Google Drive (camada §13 do desenho).
