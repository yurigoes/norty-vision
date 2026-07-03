#!/usr/bin/env bash
# ==============================================================================
# setup.sh — provisiona o PABX externo (Asterisk + coturn + Caddy) numa VPS
# com IPv4 público. Lê o .env, gera os configs, abre o firewall (UFW) e sobe.
#
# Idempotente: pode rodar de novo. NÃO apaga dados (volumes nomeados).
# Requisitos: Debian/Ubuntu com docker + docker compose v2; .env preenchido;
#             DNS A de $VOIP_DOMAIN apontando pra ESTE servidor (DNS only).
# Uso:  cp .env.example .env && nano .env && bash setup.sh
# ==============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_0=$'\033[0m'
ok(){ echo "${c_g}[OK]${c_0} $*"; }; warn(){ echo "${c_y}[!]${c_0} $*" >&2; }; die(){ echo "${c_r}[ERRO]${c_0} $*" >&2; exit 1; }

[[ -f .env ]] || die "Crie o .env (cp .env.example .env) e preencha."
set -a; . ./.env; set +a
for v in VOIP_DOMAIN PUBLIC_IP API_URL VOIP_FS_SECRET TURN_USER TURN_PASS; do
  [[ -n "${!v:-}" ]] || die "Variável $v vazia no .env"
done
[[ "$VOIP_FS_SECRET" == TROQUE* ]] && die "Troque o VOIP_FS_SECRET no .env"
[[ "$TURN_PASS" == TROQUE* ]] && die "Troque o TURN_PASS no .env"
[[ "$PUBLIC_IP" == "203.0.113.10" ]] && die "PUBLIC_IP ainda é o exemplo. Ponha o IP real."
[[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "PUBLIC_IP não parece IPv4: '$PUBLIC_IP'"
command -v docker >/dev/null || die "docker não instalado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 não instalado"
command -v jq >/dev/null || die "jq não instalado (apt install -y jq)"
command -v curl >/dev/null || die "curl não instalado"

echo "== Gerando configs =="

# ---- coturn (idem ao FreeSWITCH setup) ----
mkdir -p generated/coturn
cat > generated/coturn/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}
realm=${VOIP_DOMAIN}
external-ip=${PUBLIC_IP}
min-port=49152
max-port=65535
no-cli
no-multicast-peers
no-tlsv1
no-tlsv1_1
EOF
ok "coturn/turnserver.conf"

# ---- Asterisk base configs (copia da pasta asterisk-base/) ----
mkdir -p generated/asterisk-etc
cp -f asterisk-base/asterisk.conf       generated/asterisk-etc/
cp -f asterisk-base/modules.conf        generated/asterisk-etc/
cp -f asterisk-base/http.conf           generated/asterisk-etc/
cp -f asterisk-base/rtp.conf            generated/asterisk-etc/
cp -f asterisk-base/logger.conf         generated/asterisk-etc/
cp -f asterisk-base/extensions.conf     generated/asterisk-etc/
cp -f asterisk-base/manager.conf        generated/asterisk-etc/
# pjsip.conf base com substituição do PUBLIC_IP
sed -e "s#__PUBLIC_IP__#${PUBLIC_IP}#g" asterisk-base/pjsip.conf \
  > generated/asterisk-etc/pjsip.conf
# pjsip_dynamic.conf inicial vazio (sync-config.sh preenche)
[[ -f generated/asterisk-etc/pjsip_dynamic.conf ]] || \
  echo "; preenchido por sync-config.sh" > generated/asterisk-etc/pjsip_dynamic.conf
ok "configs base do Asterisk em generated/asterisk-etc/"

# ---- Cron de sync de ramais (a cada 30s) ----
chmod +x sync-config.sh
CRON_TMP=$(mktemp)
( crontab -l 2>/dev/null | grep -v 'asterisk-vps' || true ) > "$CRON_TMP"
echo "* * * * * cd $(pwd) && bash sync-config.sh >/dev/null 2>&1 # asterisk-vps" >> "$CRON_TMP"
echo "* * * * * sleep 30; cd $(pwd) && bash sync-config.sh >/dev/null 2>&1 # asterisk-vps" >> "$CRON_TMP"
crontab "$CRON_TMP" && rm -f "$CRON_TMP"
ok "cron de sync-config.sh instalado (30s)"

# ---- Firewall (UFW) ----
echo "== Firewall (UFW) =="
if command -v ufw >/dev/null; then
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
  ufw allow 3478 >/dev/null 2>&1 || true
  ufw allow 5349/tcp >/dev/null 2>&1 || true
  ufw allow 5060 >/dev/null 2>&1 || true    # SIP UDP+TCP (pra trunk)
  ufw allow 49152:65535/udp >/dev/null 2>&1 || true
  ufw allow 10000:20000/udp >/dev/null 2>&1 || true   # RTP Asterisk
  ok "UFW: 80/443/3478/5060/49152-65535/10000-20000"
else
  warn "UFW ausente — abra: 80,443/tcp; 5060; 3478; 5349/tcp; 49152-65535/udp; 10000-20000/udp"
fi

# ---- Roda sync uma vez ANTES de subir (já fica com ramais válidos) ----
echo "== Pull inicial dos ramais/trunks da API =="
bash sync-config.sh || warn "sync inicial falhou (API offline?); Asterisk sobe com config vazia"

echo "== Subindo containers =="
docker compose --env-file .env up -d

sleep 8
docker compose ps
echo
ok "PABX Asterisk no ar. Sinalização: wss://${VOIP_DOMAIN}/ws"
echo
echo "Próximos passos no .env.production do yugo (VPS local):"
echo "  VOIP_SIP_WS_URL=wss://${VOIP_DOMAIN}/ws"
echo "  VOIP_SIP_DOMAIN=${VOIP_DOMAIN}"
echo "  VOIP_FS_SECRET=${VOIP_FS_SECRET}"
echo "  VOIP_TURN_HOST=${VOIP_DOMAIN}  VOIP_TURN_USER=${TURN_USER}  VOIP_TURN_PASS=${TURN_PASS}"
echo
echo "Conferir status do Asterisk:"
echo "  docker exec yugo-asterisk asterisk -rx 'pjsip show endpoints'"
echo "  docker exec yugo-asterisk asterisk -rx 'pjsip show registrations'"
