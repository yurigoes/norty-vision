#!/usr/bin/env bash
# ==============================================================================
# harden-vps.sh - Hardening de Debian 12 para yugo-platform
#
# Idempotente, seguro, modular. Cada etapa pode rodar isolada.
#
# Uso:
#   sudo bash harden-vps.sh --check          # so verifica, nao altera
#   sudo bash harden-vps.sh --base           # update + pacotes essenciais
#   sudo bash harden-vps.sh --user deploy    # cria usuario nao-root com sudo+chave
#   sudo bash harden-vps.sh --firewall       # UFW (22/80/443) + fail2ban
#   sudo bash harden-vps.sh --sshd           # endurece /etc/ssh/sshd_config
#   sudo bash harden-vps.sh --docker         # instala Docker + Compose v2
#   sudo bash harden-vps.sh --kernel         # sysctl + swap + NTP + unattended
#   sudo bash harden-vps.sh --all            # tudo em sequencia segura
#
# Requisitos:
#   - Debian 12 (Bookworm)
#   - rodar como root ou via sudo
#   - chave SSH ja funcionando antes de --sshd (senao tranca fora)
# ==============================================================================

set -euo pipefail

# --- cores e logging --------------------------------------------------------
readonly C_RESET=$'\033[0m'
readonly C_RED=$'\033[31m'
readonly C_GREEN=$'\033[32m'
readonly C_YELLOW=$'\033[33m'
readonly C_BLUE=$'\033[34m'
readonly C_BOLD=$'\033[1m'

log()  { printf '%s[%s]%s %s\n' "$C_BLUE"  "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s[ERR]%s %s\n'  "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || die "Rode como root ou via sudo."
}

require_debian12() {
  [[ -f /etc/os-release ]] || die "Sem /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "debian" ]] || warn "OS=${ID:-?}, esperava debian"
  [[ "${VERSION_ID:-}" == "12" ]] || warn "VERSION=${VERSION_ID:-?}, esperava 12"
}

# --- pre-checks -------------------------------------------------------------
ensure_authorized_keys_present() {
  local user="${1:-root}"
  local home
  home=$(getent passwd "$user" | cut -d: -f6)
  [[ -n "$home" ]] || die "Usuario '$user' nao existe."
  local ak="$home/.ssh/authorized_keys"
  [[ -s "$ak" ]] || die "FATAL: $ak nao existe ou esta vazio. Adicione sua chave ANTES de mexer no SSH."
  ok "authorized_keys presente para $user ($(wc -l < "$ak") chave(s))"
}

# --- 1. BASE: update + pacotes essenciais -----------------------------------
do_base() {
  log "Atualizando indices e pacotes (apt update/upgrade)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get -o Dpkg::Options::="--force-confnew" upgrade -y
  apt-get -o Dpkg::Options::="--force-confnew" dist-upgrade -y
  apt-get autoremove -y
  apt-get clean

  log "Instalando pacotes essenciais..."
  # systemd-timesyncd ja vem com systemd; nao usar chrony (conflita).
  # python3-systemd e obrigatorio para fail2ban backend=systemd em Debian 12+
  # (sem ele o servico inicia e morre apos "Server ready" com status 255).
  # Instalacao TOLERANTE: cada pacote isolado, um que falte (ex.: pacote
  # renomeado/removido no Debian 13) nao derruba os essenciais (ufw/fail2ban).
  # Obsoletos no Debian 13 removidos: apt-transport-https (embutido no apt),
  # software-properties-common, dirmngr.
  local pkgs=(
    sudo curl wget git vim htop tmux unzip rsync
    ca-certificates gnupg lsb-release
    ufw fail2ban python3-systemd unattended-upgrades apt-listchanges
    jq tree ncdu age
  )
  local p
  for p in "${pkgs[@]}"; do
    apt-get install -y --no-install-recommends "$p" || warn "pacote '$p' nao instalou (seguindo)"
  done
  # garantia: os criticos PRECISAM estar presentes
  for p in ufw fail2ban; do
    command -v "$p" >/dev/null 2>&1 || dpkg -s "$p" >/dev/null 2>&1 || die "FATAL: '$p' nao instalou. Rode: apt-get install -y $p"
  done

  # sops nao esta nos repos default do Debian 12 estavel; baixa binario oficial
  if ! command -v sops >/dev/null 2>&1; then
    log "Baixando sops..."
    local sops_ver="3.9.4"
    local sops_arch
    sops_arch=$(dpkg --print-architecture)
    curl -fsSL -o /tmp/sops.deb \
      "https://github.com/getsops/sops/releases/download/v${sops_ver}/sops_${sops_ver}_${sops_arch}.deb" \
      && dpkg -i /tmp/sops.deb \
      && rm -f /tmp/sops.deb \
      || warn "sops nao instalou (segue sem ele por agora)"
  fi

  ok "Pacotes base instalados."
}

# --- 2. USER: cria usuario nao-root com sudo + chave SSH --------------------
do_user() {
  local username="${1:-deploy}"
  if id -u "$username" >/dev/null 2>&1; then
    log "Usuario '$username' ja existe."
  else
    log "Criando usuario '$username'..."
    adduser --disabled-password --gecos "yugo-platform deploy user" "$username"
  fi

  log "Adicionando '$username' ao grupo sudo..."
  usermod -aG sudo "$username"

  # sudo sem senha (so se NOPASSWD nao existir ainda)
  local sudoers="/etc/sudoers.d/90-$username"
  if [[ ! -f "$sudoers" ]]; then
    echo "$username ALL=(ALL) NOPASSWD: ALL" > "$sudoers"
    chmod 0440 "$sudoers"
    visudo -cf "$sudoers" >/dev/null || die "sudoers invalido!"
    ok "Sudo sem senha configurado para $username."
  fi

  # copia authorized_keys do root pra este usuario
  local src="/root/.ssh/authorized_keys"
  local dst_dir="/home/$username/.ssh"
  local dst="$dst_dir/authorized_keys"
  [[ -s "$src" ]] || die "Nao ha /root/.ssh/authorized_keys pra copiar."
  install -d -m 700 -o "$username" -g "$username" "$dst_dir"
  install -m 600 -o "$username" -g "$username" "$src" "$dst"
  ok "authorized_keys copiada para $username."

  # shell padrao bash
  chsh -s /bin/bash "$username" || true

  ok "Usuario '$username' pronto. Teste login antes de prosseguir!"
  warn "Em outro terminal: ssh $username@<ip> e confirma sudo -i funciona."
}

# --- 3b. RUSTDESK: abre portas do servidor self-hosted -----------------------
# hbbs = signaling (21115/21116/21118), hbbr = relay (21117/21119), 21116/udp
# Chamada automaticamente por do_firewall se detectar processos rodando.
# Tambem expoe como --rustdesk para casos onde os daemons sobem depois.
do_rustdesk_ports() {
  ufw allow 21115/tcp comment 'RustDesk hbbs ID server' || true
  ufw allow 21116/tcp comment 'RustDesk hbbs relay TCP' || true
  ufw allow 21116/udp comment 'RustDesk hbbs NAT' || true
  ufw allow 21117/tcp comment 'RustDesk hbbr relay' || true
  ufw allow 21118/tcp comment 'RustDesk hbbs WS' || true
  ufw allow 21119/tcp comment 'RustDesk hbbr WSS' || true
  ok "Portas RustDesk 21115-21119 liberadas."
}

# --- 3. FIREWALL: UFW + fail2ban --------------------------------------------
do_firewall() {
  log "Configurando UFW..."

  # porta EFETIVA do SSH (pode ter sido trocada pelo --sshd-pass). Liberar a
  # porta errada aqui = se trancar pra fora quando o UFW ligar.
  local sshport
  sshport=$(sshd -T 2>/dev/null | awk '/^port / {print $2; exit}'); sshport=${sshport:-22}

  # politica default
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing

  # SSH na porta detectada (fail2ban cuida do brute-force)
  ufw allow "${sshport}/tcp" comment 'SSH'
  if [[ "$sshport" != "22" ]]; then
    warn "SSH detectado na porta $sshport — liberei ELA (a 22 ficou FECHADA). Reconecte com -p $sshport."
  fi

  # HTTP/HTTPS
  ufw allow 80/tcp comment 'HTTP (Caddy)'
  ufw allow 443/tcp comment 'HTTPS (Caddy)'

  ufw --force enable
  ufw status verbose

  # se RustDesk estiver rodando, libera as portas dele tambem
  if pgrep -f 'hbbs|hbbr' >/dev/null 2>&1; then
    log "RustDesk detectado (hbbs/hbbr rodando) - liberando portas 21115-21119..."
    do_rustdesk_ports
  fi

  log "Configurando fail2ban (jail SSH)..."
  # garante que o pacote esta instalado de verdade,
  # incluindo o binding python pro journald (backend=systemd nao roda sem ele)
  apt-get install -y --no-install-recommends fail2ban python3-systemd

  # backend=systemd evita dependencia de /var/log/auth.log em sistemas
  # que usam journald (Debian 12+). port = porta real do SSH (ban na porta certa).
  cat > /etc/fail2ban/jail.local <<JAIL
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled  = true
port     = ${sshport}
filter   = sshd
maxretry = 3
bantime  = 24h
JAIL

  # cria diretorio do socket caso esteja faltando (bug ocasional no Debian)
  install -d -m 0755 /var/run/fail2ban
  systemctl enable fail2ban
  systemctl restart fail2ban || true

  # espera ate 10s pelo socket
  for i in {1..10}; do
    if fail2ban-client ping >/dev/null 2>&1; then
      ok "fail2ban respondendo."
      fail2ban-client status sshd || warn "sshd jail nao listado"
      break
    fi
    sleep 1
  done
  systemctl is-active --quiet fail2ban || warn "fail2ban inativo - rodar: journalctl -u fail2ban -n 50"

  ok "Firewall e fail2ban ativos."
}

# --- 4. SSHD: hardening via drop-in (Debian 12 friendly) --------------------
# IMPORTANTE: Debian 12 inclui Include /etc/ssh/sshd_config.d/*.conf NO TOPO
# do sshd_config. Drop-ins sao lidos primeiro e a primeira ocorrencia ganha.
# Por isso editar sshd_config diretamente nao funciona se houver drop-in.
# Solucao: criar nosso proprio drop-in com prefixo numerico baixo para vencer.
do_sshd() {
  ensure_authorized_keys_present root

  local dropdir="/etc/ssh/sshd_config.d"
  local dropfile="$dropdir/00-yugo-hardening.conf"
  install -d -m 0755 "$dropdir"

  # backup do drop-in anterior caso exista
  if [[ -f "$dropfile" ]]; then
    cp -a "$dropfile" "$dropfile.bak.$(date +%Y%m%d-%H%M%S)"
  fi

  log "Escrevendo drop-in $dropfile (prefixo 00 vence drop-ins do sistema)..."
  cat > "$dropfile" <<'CONF'
# yugo-platform hardening - sobrepoe qualquer drop-in posterior
PasswordAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitEmptyPasswords no
X11Forwarding no
AllowTcpForwarding yes
MaxAuthTries 3
MaxSessions 10
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
CONF
  chmod 0644 "$dropfile"

  # remove possiveis overrides em drop-ins do cloud-init que reabilitam senha
  for f in /etc/ssh/sshd_config.d/50-cloud-init.conf \
           /etc/ssh/sshd_config.d/60-cloudimg-settings.conf; do
    if [[ -f "$f" ]] && grep -qE '^PasswordAuthentication[[:space:]]+yes' "$f"; then
      log "Comentando 'PasswordAuthentication yes' em $f"
      sed -i.bak -E 's|^(PasswordAuthentication[[:space:]]+yes)|# disabled by yugo-hardening: \1|' "$f"
    fi
  done

  # valida tudo antes de aplicar
  sshd -t || die "Config sshd invalida! Removendo drop-in e abortando."

  systemctl reload ssh

  # confirma estado efetivo
  local effective_pw effective_root
  effective_pw=$(sshd -T 2>/dev/null | awk '/^passwordauthentication / {print $2}')
  effective_root=$(sshd -T 2>/dev/null | awk '/^permitrootlogin / {print $2}')
  ok "sshd reload OK."
  ok "PasswordAuthentication efetivo: $effective_pw (esperado: no)"
  ok "PermitRootLogin efetivo: $effective_root (esperado: prohibit-password)"
  if [[ "$effective_pw" != "no" ]]; then
    warn "Ainda mostra '$effective_pw' - verificar drop-ins em $dropdir"
    ls -la "$dropdir"
  fi
  warn "ABRA OUTRA SESSAO NUMA NOVA JANELA para confirmar antes de fechar esta."
}

# --- 4b. SSHD (mantendo SENHA) — endurece sem exigir chave pública ----------
# Para quem NÃO quer usar chave pública. Mantém PasswordAuthentication yes, mas
# aplica o resto do hardening (MaxAuthTries, sem senha vazia, sem X11, timeouts).
# O bloqueio de IPs que tentam acessar vem do fail2ban (--firewall), NÃO do SSH.
# Opcional: SSH_PORT=2222 bash harden-vps.sh --sshd-pass  (troca a porta).
do_sshd_pass() {
  local dropdir="/etc/ssh/sshd_config.d"
  local dropfile="$dropdir/00-yugo-hardening.conf"
  install -d -m 0755 "$dropdir"
  [[ -f "$dropfile" ]] && cp -a "$dropfile" "$dropfile.bak.$(date +%Y%m%d-%H%M%S)"

  local port="${SSH_PORT:-22}"
  log "Escrevendo $dropfile (SENHA mantida; porta $port)..."
  cat > "$dropfile" <<CONF
# yugo-platform hardening (modo SENHA — sem chave pública)
Port $port
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
MaxSessions 10
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
CONF
  chmod 0644 "$dropfile"

  # cloud-init às vezes força PasswordAuthentication; aqui queremos SIM, então só garante
  sshd -t || die "Config sshd inválida! Revise $dropfile."
  if [[ "$port" != "22" ]]; then
    log "Liberando porta $port no UFW (e mantendo 22 até você confirmar)..."
    command -v ufw >/dev/null && ufw allow "${port}/tcp" comment 'SSH custom' || true
    warn "fail2ban: ajuste 'port = $port' no jail [sshd] de /etc/fail2ban/jail.local e reinicie."
  fi
  systemctl reload ssh
  ok "sshd endurecido (senha ON). PasswordAuth: $(sshd -T 2>/dev/null | awk '/^passwordauthentication / {print $2}')"
  warn "Use SENHA FORTE no root. ABRA OUTRA SESSÃO pra confirmar antes de fechar esta."
  warn "Para bloquear quem tenta acessar: rode tambem '--firewall' (fail2ban bane após 3 tentativas)."
}

# --- 5. DOCKER + COMPOSE ----------------------------------------------------
do_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker ja instalado: $(docker --version)"
  else
    log "Instalando Docker (repositorio oficial)..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    local codename
    codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $codename stable" \
      > /etc/apt/sources.list.d/docker.list

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io \
                       docker-buildx-plugin docker-compose-plugin
  fi

  systemctl enable docker
  systemctl start docker

  # adiciona usuario deploy ao grupo docker
  if id -u deploy >/dev/null 2>&1; then
    usermod -aG docker deploy
    ok "Usuario deploy adicionado ao grupo docker (logout/login para refletir)."
  fi

  # config de daemon: log rotativo + storage moderno
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true
}
JSON
  systemctl restart docker

  ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) pronto."
  ok "Compose v2 $(docker compose version --short)."
}

# --- 6. KERNEL: sysctl + swap + NTP + unattended-upgrades -------------------
do_kernel() {
  log "Aplicando sysctl hardening..."
  cat > /etc/sysctl.d/99-yugo-hardening.conf <<'SYSCTL'
# rede
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_rfc1337 = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# filesystem
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0

# kernel
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.unprivileged_bpf_disabled = 1
SYSCTL
  sysctl --system >/dev/null
  ok "sysctl aplicado."

  # swap se nao tiver
  if [[ $(swapon --show=NAME --noheadings | wc -l) -eq 0 ]]; then
    log "Sem swap detectado. Criando /swapfile (2G)..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
    ok "Swap 2G ativo."
  else
    ok "Swap ja configurado: $(swapon --show)"
  fi

  # NTP via systemd-timesyncd (ja vem com systemd; sem dependencia extra)
  timedatectl set-timezone America/Sao_Paulo || warn "set-timezone falhou"
  timedatectl set-ntp true || warn "set-ntp falhou"
  systemctl enable --now systemd-timesyncd 2>/dev/null || true
  ok "Timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo '?') / NTP: $(timedatectl show -p NTP --value 2>/dev/null || echo '?')"

  # unattended-upgrades para patches de seguranca
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename},label=Debian-Security";
  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
Unattended-Upgrade::Package-Blacklist { };
Unattended-Upgrade::DevRelease "auto";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  systemctl enable unattended-upgrades
  systemctl restart unattended-upgrades
  ok "Atualizacoes automaticas de seguranca habilitadas."

  # journal: limites
  mkdir -p /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/00-yugo.conf <<'EOF'
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
SystemKeepFree=200M
MaxRetentionSec=30day
EOF
  systemctl restart systemd-journald
  ok "Journald limitado a 500M."
}

# --- 7. CHECK: relatorio do estado ------------------------------------------
do_check() {
  printf '\n%s=== Estado da VPS ===%s\n' "$C_BOLD" "$C_RESET"
  printf '%-32s %s\n' 'hostname:'            "$(hostname)"
  printf '%-32s %s\n' 'os:'                  "$( . /etc/os-release; echo "$PRETTY_NAME" )"
  printf '%-32s %s\n' 'kernel:'              "$(uname -r)"
  printf '%-32s %s\n' 'timezone:'            "$(timedatectl show -p Timezone --value 2>/dev/null || echo '?')"
  printf '%-32s %s\n' 'uptime:'              "$(uptime -p)"
  printf '%-32s %s\n' 'cpu:'                 "$(nproc) cores"
  printf '%-32s %s\n' 'mem:'                 "$(free -h | awk '/Mem:/ {print $2 " total, " $7 " disp."}')"
  printf '%-32s %s\n' 'disk /:'              "$(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 " usado)"}')"
  printf '%-32s %s\n' 'swap:'                "$(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ' || echo 'nenhum')"
  printf '%-32s %s\n' 'docker:'              "$(command -v docker >/dev/null && docker --version || echo 'nao instalado')"
  printf '%-32s %s\n' 'ufw:'                 "$(ufw status 2>/dev/null | head -1 || echo 'nao instalado')"
  printf '%-32s %s\n' 'fail2ban:'            "$(systemctl is-active fail2ban 2>/dev/null || echo 'nao instalado')"
  printf '%-32s %s\n' 'unattended-upgrades:' "$(systemctl is-active unattended-upgrades 2>/dev/null || echo '?')"
  printf '%-32s %s\n' 'ssh PasswordAuth:'    "$(sshd -T 2>/dev/null | awk '/^passwordauthentication / {print $2}' || echo '?')"
  printf '%-32s %s\n' 'ssh PermitRoot:'      "$(sshd -T 2>/dev/null | awk '/^permitrootlogin / {print $2}' || echo '?')"
  printf '%-32s %s\n' 'ssh PubkeyAuth:'      "$(sshd -T 2>/dev/null | awk '/^pubkeyauthentication / {print $2}' || echo '?')"
  printf '%-32s %s\n' 'NTP sincronizado:'    "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo '?')"
  printf '%-32s %s\n' 'fail2ban jails:'      "$(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/ {gsub(/^[[:space:]]+/,"",$2); print $2}' || echo '?')"
  printf '%-32s %s\n' 'usuarios sudo:'       "$(getent group sudo | cut -d: -f4)"
  printf '\n'
}

# --- 8. ALL: sequencia segura -----------------------------------------------
do_all() {
  do_base
  do_user deploy
  warn "================================================================"
  warn "PAUSA: abra outra sessao 'ssh deploy@<ip>' e teste 'sudo -i'."
  warn "Continuando em 10s. CTRL+C aborta se houver problema."
  warn "================================================================"
  sleep 10
  do_kernel
  do_firewall
  do_docker
  do_sshd
  do_check
}

# --- entrypoint -------------------------------------------------------------
require_root
require_debian12

case "${1:-}" in
  --check)    do_check ;;
  --base)     do_base ;;
  --user)     do_user "${2:-deploy}" ;;
  --firewall) do_firewall ;;
  --rustdesk) do_rustdesk_ports ;;
  --sshd)     do_sshd ;;
  --sshd-pass) do_sshd_pass ;;
  --docker)   do_docker ;;
  --kernel)   do_kernel ;;
  --all)      do_all ;;
  *)
    cat <<USAGE
harden-vps.sh - hardening de Debian 12

Uso (rode como root):
  $0 --check                 # so verifica
  $0 --base                  # apt update/upgrade + pacotes
  $0 --user [nome=deploy]    # cria usuario nao-root com sudo+chave
  $0 --firewall              # UFW + fail2ban (detecta RustDesk auto)
  $0 --rustdesk              # so libera 21115-21119 (caso suba depois)
  $0 --sshd                  # endurece sshd c/ CHAVE (desliga senha; precisa chave!)
  $0 --sshd-pass             # endurece sshd MANTENDO SENHA (sem chave publica)
  $0 --docker                # Docker CE + Compose v2
  $0 --kernel                # sysctl + swap + NTP + unattended-upgrades
  $0 --all                   # tudo em sequencia segura (com pausa)

Recomendado primeira vez:
  $0 --base
  $0 --user deploy
  # teste login com deploy em OUTRA sessao
  $0 --kernel
  $0 --firewall
  $0 --docker
  $0 --sshd                  # POR ULTIMO, com sessao backup aberta
  $0 --check
USAGE
    ;;
esac
