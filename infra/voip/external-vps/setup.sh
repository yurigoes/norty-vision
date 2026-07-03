#!/usr/bin/env bash
# ==============================================================================
# setup.sh — provisiona o PABX externo (FreeSWITCH + coturn + Caddy) numa VPS
# com IP PÚBLICO. Lê o .env, gera os configs, abre o firewall (UFW) e sobe tudo.
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
[[ "$PUBLIC_IP" == "203.0.113.10" ]] && die "PUBLIC_IP ainda é o exemplo. Ponha o IP público REAL desta VPS."
[[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "PUBLIC_IP não parece um IPv4 válido: '$PUBLIC_IP'"
{ [[ "$TURN_PASS" == "yugo" ]] || (( ${#TURN_PASS} < 8 )); } && warn "TURN_PASS fraco ('$TURN_PASS') — recomendo trocar por algo forte (>=16 chars)."
command -v docker >/dev/null || die "docker não instalado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 não instalado"

echo "== Gerando configs =="
mkdir -p generated/coturn generated/freeswitch-conf

# coturn
sed -e "s#__TURN_USER__#${TURN_USER}#g" -e "s#__TURN_PASS__#${TURN_PASS}#g" \
    -e "s#__VOIP_DOMAIN__#${VOIP_DOMAIN}#g" -e "s#__PUBLIC_IP__#${PUBLIC_IP}#g" \
    templates/coturn.turnserver.conf.tmpl > generated/coturn/turnserver.conf
ok "coturn/turnserver.conf"

# FreeSWITCH: extrai os defaults da imagem (1ª vez) e aplica nossos patches.
# A imagem não tem /etc/freeswitch em build-time; achamos o freeswitch.xml de verdade.
if [[ ! -f generated/freeswitch-conf/freeswitch.xml ]]; then
  echo "Localizando a config padrão do FreeSWITCH dentro da imagem…"
  FS_CONF_SRC=$(docker run --rm --entrypoint sh safarov/freeswitch:latest -c \
    'f=$(find / -type f -name freeswitch.xml 2>/dev/null | head -n1); [ -n "$f" ] && dirname "$f"') || true
  [[ -n "${FS_CONF_SRC:-}" ]] || die "Não achei freeswitch.xml na imagem. Rode e me mande o caminho:
    docker run --rm --entrypoint sh safarov/freeswitch:latest -c 'find / -name freeswitch.xml'"
  echo "Config padrão em: ${FS_CONF_SRC} — extraindo…"
  docker run --rm --entrypoint sh safarov/freeswitch:latest -c "cd '${FS_CONF_SRC}' && tar cf - ." \
    | tar -C generated/freeswitch-conf -xf - || die "Falha extraindo config do FreeSWITCH"
  ok "config padrão extraída de ${FS_CONF_SRC}"
fi

# xml_curl → API do yugo
sed -e "s#__API_URL__#${API_URL}#g" -e "s#__VOIP_FS_SECRET__#${VOIP_FS_SECRET}#g" \
    templates/xml_curl.conf.xml.tmpl > generated/freeswitch-conf/autoload_configs/xml_curl.conf.xml
ok "autoload_configs/xml_curl.conf.xml"

# vars.xml: domínio + IP externo da mídia (servidor tem IPv4 público)
VARS=generated/freeswitch-conf/vars.xml
if [[ -f "$VARS" ]]; then
  sed -i -E "s#(default_password=)[^\"]*#\1$(openssl rand -hex 6)#" "$VARS" 2>/dev/null || true
  # external_rtp_ip / external_sip_ip = IP público (sem isso o SDP anuncia IP interno)
  sed -i -E "s#external_rtp_ip=[^\"]*#external_rtp_ip=${PUBLIC_IP}#g" "$VARS" 2>/dev/null || true
  sed -i -E "s#external_sip_ip=[^\"]*#external_sip_ip=${PUBLIC_IP}#g" "$VARS" 2>/dev/null || true
  ok "vars.xml (external IPs = ${PUBLIC_IP})"
else
  warn "vars.xml não encontrado — confira manualmente external_rtp_ip/external_sip_ip"
fi

# internal.xml: garante ws-binding :5066 (Caddy termina o TLS e repassa pra cá).
# Também remove apply-inbound-acl (que dropa silenciosamente o REGISTER vindo
# via WS de fora da ACL "domains").
INT=generated/freeswitch-conf/sip_profiles/internal.xml
if [[ -f "$INT" ]]; then
  if ! grep -q 'name="ws-binding"' "$INT"; then
    sed -i 's#</settings>#  <param name="ws-binding" value=":5066"/>\n  </settings>#' "$INT" || true
  fi
  sed -i 's#<param name="apply-inbound-acl".*$#<!-- apply-inbound-acl: removido (dropava WS REGISTER) -->#g' "$INT" || true
  ok "internal.xml (ws-binding :5066 + sem apply-inbound-acl)"
fi

# modules.conf.xml: precisa carregar mod_xml_curl (pra perguntar à nossa API quem
# é o ramal) e mod_curl. Vanilla vem com esses comentados.
MOD=generated/freeswitch-conf/autoload_configs/modules.conf.xml
if [[ -f "$MOD" ]]; then
  sed -i 's#<!-- <load module="mod_xml_curl"/> -->#<load module="mod_xml_curl"/>#g' "$MOD" || true
  sed -i 's#<!-- <load module="mod_curl"/> -->#<load module="mod_curl"/>#g' "$MOD" || true
  ok "modules.conf.xml (mod_xml_curl + mod_curl ativos)"
fi

# Trunk SIP (PSTN, opcional) — se TRUNK_HOST/USER/PASS estiverem no .env, gera
# o gateway no perfil external. O FreeSWITCH registra na operadora.
TRUNK_NAME="${TRUNK_NAME:-yugo-trunk}"
if [[ -n "${TRUNK_HOST:-}" && -n "${TRUNK_USER:-}" && -n "${TRUNK_PASS:-}" ]]; then
  mkdir -p generated/freeswitch-conf/sip_profiles/external
  sed -e "s#__TRUNK_NAME__#${TRUNK_NAME}#g" \
      -e "s#__TRUNK_HOST__#${TRUNK_HOST}#g" \
      -e "s#__TRUNK_USER__#${TRUNK_USER}#g" \
      -e "s#__TRUNK_PASS__#${TRUNK_PASS}#g" \
      templates/trunk.xml.tmpl > "generated/freeswitch-conf/sip_profiles/external/${TRUNK_NAME}.xml"
  ok "sip_profiles/external/${TRUNK_NAME}.xml (registra em ${TRUNK_HOST})"
  TRUNK_CONFIGURED=1
else
  warn "Trunk SIP não configurado (TRUNK_HOST/USER/PASS vazios) — sem discagem pra números externos."
  TRUNK_CONFIGURED=0
fi

echo "== Firewall (UFW) =="
if command -v ufw >/dev/null; then
  ufw allow 22/tcp        >/dev/null 2>&1 || true   # SSH (não se tranque pra fora)
  ufw allow 80,443/tcp    >/dev/null 2>&1 || true   # Caddy (ACME + WSS)
  ufw allow 3478          >/dev/null 2>&1 || true   # coturn STUN/TURN (udp+tcp)
  ufw allow 5349/tcp      >/dev/null 2>&1 || true   # coturn TLS
  ufw allow 49152:65535/udp >/dev/null 2>&1 || true # coturn relay
  ufw allow 16384:32768/udp >/dev/null 2>&1 || true # FreeSWITCH RTP
  ok "regras UFW aplicadas (confirme: ufw status)"
else
  warn "UFW ausente — abra no seu firewall: 80,443/tcp; 3478; 5349/tcp; 49152-65535/udp; 16384-32768/udp"
fi

# Sync de gateways multiempresa (call center): cron a cada 30s puxa /api/voip/fs/gateways
# e reescreve sip_profiles/external/*.xml + reloadxml. Idempotente.
if command -v jq >/dev/null && command -v crontab >/dev/null; then
  install -m 0755 "$HERE/sync-gateways.sh" "$HERE/sync-gateways.sh" 2>/dev/null || true
  chmod +x sync-gateways.sh
  # remove qualquer cron antigo do sync e instala um novo (2x por minuto = 30s)
  CRON_TMP=$(mktemp)
  ( crontab -l 2>/dev/null | grep -v 'sync-gateways.sh' || true ) > "$CRON_TMP"
  echo "* * * * * cd $(pwd) && bash sync-gateways.sh >/dev/null 2>&1" >> "$CRON_TMP"
  echo "* * * * * sleep 30; cd $(pwd) && bash sync-gateways.sh >/dev/null 2>&1" >> "$CRON_TMP"
  crontab "$CRON_TMP" && rm -f "$CRON_TMP"
  ok "cron de sync de gateways instalado (30s)."
else
  warn "jq/crontab ausentes — sync de gateways multiempresa não instalado (apt install -y jq cron)"
fi

echo "== Subindo containers =="
docker compose --env-file .env up -d

# se já estava rodando, recarrega config + sofia (pra pegar novo gateway/wss sem
# precisar de docker restart). Erros aqui são tolerados (vai aplicar no próximo restart).
if docker ps --format '{{.Names}}' | grep -q '^yugo-fs$'; then
  # imagem alpine do FS não vem com ca-certificates → mod_xml_curl falha HTTPS.
  # Copia o CA-bundle do host (pode ter mudado entre runs). Idempotente.
  if [[ -r /etc/ssl/certs/ca-certificates.crt ]]; then
    docker exec yugo-fs mkdir -p /etc/ssl/certs 2>/dev/null || true
    docker cp /etc/ssl/certs/ca-certificates.crt yugo-fs:/etc/ssl/certs/ca-certificates.crt 2>/dev/null \
      && ok "CA-bundle copiado pra yugo-fs (/etc/ssl/certs/ca-certificates.crt)" \
      || warn "Não consegui copiar CA-bundle pra yugo-fs (HTTPS pode falhar)"
  fi
  docker exec yugo-fs fs_cli -x "reloadxml" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "load mod_curl" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "load mod_xml_curl" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "reload mod_xml_curl" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "xml_flush_cache" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "sofia profile internal flush_inbound_reg reboot" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "sofia profile internal restart" >/dev/null 2>&1 || true
  docker exec yugo-fs fs_cli -x "sofia profile external rescan reloadxml" >/dev/null 2>&1 || true
fi

ok "PABX no ar. Sinalização: wss://${VOIP_DOMAIN}  (use isso em VOIP_SIP_WS_URL no yugo)"
if [[ "${TRUNK_CONFIGURED:-0}" == "1" ]]; then
  echo "Trunk PSTN: ${TRUNK_NAME} registrando em ${TRUNK_HOST}."
  echo "  Status do registro: docker exec yugo-fs fs_cli -x 'sofia status gateway ${TRUNK_NAME}'"
  echo "  No .env.production do yugo (opcional): VOIP_TRUNK_NAME=${TRUNK_NAME}"
fi
echo
echo "Próximos passos no .env.production do YUGO (VPS local):"
echo "  VOIP_SIP_WS_URL=wss://${VOIP_DOMAIN}"
echo "  VOIP_SIP_DOMAIN=${VOIP_DOMAIN}"
echo "  VOIP_FS_SECRET=${VOIP_FS_SECRET}"
echo "  VOIP_TURN_HOST=${VOIP_DOMAIN}   VOIP_TURN_USER=${TURN_USER}   VOIP_TURN_PASS=${TURN_PASS}"
echo "Depois: redeploy do yugo. Logs daqui: docker compose logs -f freeswitch caddy"
