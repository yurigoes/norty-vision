# PABX externo (VPS com IP público) — modo SIP / Fase B.2

Sobe **FreeSWITCH + coturn + Caddy** numa VPS **com IPv4 público** (2 vCPU / 4 GB já
bastam). É aqui que as **portas ficam abertas** (mídia RTP/UDP) — coisa que a VPS local
atrás do Cloudflare Tunnel não pode fazer. A app/banco/API continuam na VPS local; só a
voz passa por aqui. Quando quiser **número real (PSTN)**, é só plugar um trunk SIP no
FreeSWITCH (Fase C, pago).

> Ativação **assistida**: FreeSWITCH costuma exigir ajuste fino no 1º teste de voz.

## Pré-requisitos
1. **VPS com IPv4 público de verdade** (não CGNAT). Teste: `curl -4 ifconfig.me` deve bater
   com o IP que o provedor te deu, e esse IP tem que ser acessível de fora.
2. **DNS**: crie `voip.<seu-dominio>` como **A** apontando pro IP da VPS, **DNS only**
   (nuvem cinza no Cloudflare — NÃO proxied; WSS e UDP precisam ir direto).
3. Docker + docker compose v2 na VPS.

## Levar os arquivos pra VPS (repo PRIVADO, sem chave/sem token)
O repo é privado, então `git clone` não funciona direto. A forma mais simples é
**copiar do seu PC via scp** (usa a senha SSH que você já usa — nada de GitHub):

```powershell
# no Windows (PowerShell), do seu PC onde está o repo:
scp -r "A:\yugochat\yugo-platform\infra\voip\external-vps" root@<IP_DA_VPS>:/opt/pabx
scp "A:\yugochat\yugo-platform\infra\scripts\harden-vps.sh" root@<IP_DA_VPS>:/opt/pabx/
```
> Alternativa (se preferir git): crie um **Personal Access Token** no GitHub (Settings →
> Developer settings → Tokens, escopo `repo`) e clone com ele — sem chave SSH:
> `git clone https://<TOKEN>@github.com/yurigoes/yugo-platform.git`. O token é só pra puxar.

## Passos
```bash
# na VPS externa, dentro de /opt/pabx:
cd /opt/pabx
cp .env.example .env
nano .env            # preencha VOIP_DOMAIN, PUBLIC_IP, API_URL, VOIP_FS_SECRET, TURN_USER/PASS
bash setup.sh        # gera configs, abre UFW e sobe FreeSWITCH+coturn+Caddy
```
O `VOIP_FS_SECRET` e `TURN_USER/PASS` têm que ser **os mesmos** configurados no yugo.

## Atualizar depois (quando eu mudar algo no repo)
Como é scp, pra atualizar basta recopiar a pasta do seu PC:
```powershell
scp -r "A:\yugochat\yugo-platform\infra\voip\external-vps" root@<IP_DA_VPS>:/opt/pabx
```
e na VPS rodar `bash setup.sh` de novo (idempotente, não apaga dados).

## Ligar no yugo (VPS local, `.env.production`)
```
VOIP_SIP_WS_URL=wss://voip.<seu-dominio>
VOIP_SIP_DOMAIN=voip.<seu-dominio>
VOIP_FS_SECRET=<o mesmo do setup.sh>
VOIP_TURN_HOST=voip.<seu-dominio>
VOIP_TURN_USER=yugo
VOIP_TURN_PASS=<o mesmo do setup.sh>
```
Com `VOIP_SIP_WS_URL` setado, a API passa o softphone pro **modo SIP** automaticamente
(o `/api/voip/register` devolve `mode:"sip"`). Faça o redeploy normal do yugo. Sem essa
variável, o app continua no **modo P2P** (Cloudflare TURN) — nada quebra na transição.

## Portas abertas pelo setup (confira `ufw status`)
- **80, 443/tcp** — Caddy (cert Let's Encrypt + WSS da sinalização)
- **3478 (udp+tcp)** e **5349/tcp** — coturn STUN/TURN
- **49152–65535/udp** — relay do coturn
- **16384–32768/udp** — RTP do FreeSWITCH

## Como funciona
- O navegador do operador conecta em `wss://voip.<dominio>` → Caddy termina o TLS e
  repassa pro FreeSWITCH (`ws-binding :5066`).
- FreeSWITCH pede auth/roteamento do ramal pra **API do yugo** via `mod_xml_curl`
  (`${API_URL}/api/voip/fs/xml`, protegido pelo `VOIP_FS_SECRET`).
- Mídia: o navegador manda RTP direto pro IP público do FreeSWITCH (coturn entra como
  relay quando a rede do operador bloqueia UDP).
- Conferência: sala `9000` (dialplan) **ou** o botão Jitsi do app.

## Diagnóstico
- `docker compose logs -f freeswitch caddy`
- Registro chegando? `docker exec yugo-fs fs_cli -x 'sofia status profile internal reg'`
- Cert do Caddy: `docker compose logs caddy | grep -i certificate`
- xml_curl OK? veja no log do FreeSWITCH chamadas a `/api/voip/fs/xml` retornando 200.

## Tuning provável no 1º teste (assistido)
- `vars.xml`: `external_rtp_ip` / `external_sip_ip` = IP público (o setup tenta, confirme).
- Faixa RTP coincidindo com o firewall (16384–32768).
- Se a operadora do operador bloquear UDP, o coturn precisa estar acessível (TURN/TCP 443
  via `turns:` pode ajudar — ajustamos no teste).
