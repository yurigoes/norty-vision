#!/usr/bin/env bash
# ==============================================================================
# capacity-check.sh — mede a folga da VPS pra decidir se o VoIP interno (B.2,
# FreeSWITCH/WebRTC) cabe na máquina atual. Roda NA VPS. Só leitura (não muda nada).
#
# Uso:
#   bash infra/scripts/capacity-check.sh
#
# Mostra: CPUs, carga (load average), RAM/swap livres, disco, uso por container
# (docker stats), ociosidade de CPU (vmstat) e um VEREDITO heurístico.
# Rode de preferência no HORÁRIO DE PICO (mais operadores logados/atendendo).
# ==============================================================================
set -uo pipefail
C_B=$'\033[34m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
hdr(){ printf '\n%s== %s ==%s\n' "$C_B" "$*" "$C_0"; }

CORES=$(nproc 2>/dev/null || echo 1)
hdr "CPU"
echo "Núcleos (nproc): $CORES"
lscpu 2>/dev/null | grep -E 'Model name|MHz' | sed 's/^/  /' || true
read -r l1 l5 l15 _ < /proc/loadavg
echo "Load average: 1min=$l1  5min=$l5  15min=$l15  (compare com $CORES núcleos)"

hdr "Ociosidade de CPU (vmstat 1x5)"
if command -v vmstat >/dev/null; then
  vmstat 1 5 | tail -1 | awk -v c="$CORES" '{ printf "  idle=%s%%  iowait=%s%%  (us=%s sy=%s)\n", $15, $16, $13, $14 }'
  IDLE=$(vmstat 1 3 | tail -1 | awk '{print $15}')
else echo "  (vmstat não instalado: apt install procps)"; IDLE=""; fi

hdr "RAM / Swap"
free -h | sed 's/^/  /'
MEM_AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
SWAP_TOTAL_MB=$(free -m | awk '/^Swap:/{print $2}')
echo "  RAM disponível: ${MEM_AVAIL_MB} MB · Swap total: ${SWAP_TOTAL_MB} MB"

hdr "Disco"
df -h / 2>/dev/null | sed 's/^/  /'

hdr "Uso por container (docker stats)"
if command -v docker >/dev/null; then
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null | sed 's/^/  /' || echo "  (sem permissão docker?)"
  if docker ps --format '{{.Names}}' | grep -q '^yugo-ollama$'; then
    echo "  ⚠ Ollama presente: IA local pode consumir CPU/RAM significativos quando responde."
  fi
else echo "  docker não encontrado"; fi

# ---- veredito heurístico ----
hdr "VEREDITO (heurístico p/ VoIP interno B.2)"
load5_x10=$(awk -v l="$l5" 'BEGIN{printf "%d", l*10}')
cores_x10=$(( CORES * 10 ))
ok=1; notes=()
# carga: load5 deve estar abaixo de ~70% dos núcleos
if (( load5_x10 > cores_x10 * 7 / 10 )); then ok=0; notes+=("Carga (5min=$l5) alta p/ $CORES núcleos — CPU sob pressão."); fi
# RAM: pelo menos ~1GB livre p/ FreeSWITCH+coturn
if [[ -n "${MEM_AVAIL_MB:-}" ]] && (( MEM_AVAIL_MB < 1024 )); then ok=0; notes+=("RAM disponível baixa (${MEM_AVAIL_MB}MB) — recomendado >=1024MB de folga."); fi
# idle de CPU: >=40%
if [[ -n "${IDLE:-}" ]] && (( IDLE < 40 )); then ok=0; notes+=("CPU ociosa baixa (${IDLE}%) — recomendado >=40% no pico."); fi
# swap inexistente é risco em VPS pequena
if [[ -n "${SWAP_TOTAL_MB:-}" ]] && (( SWAP_TOTAL_MB == 0 )); then notes+=("Sem swap — em VPS pequena, ative swap (ensure-swap.sh) antes de adicionar serviços."); fi

if (( ok == 1 )); then
  printf '%s[OK]%s Há folga p/ um VoIP interno modesto (ramais WebRTC, opus passthrough,\n' "$C_G" "$C_0"
  echo "     dezenas de chamadas internas simultâneas). Suba o FreeSWITCH e MONITORE no pico."
else
  printf '%s[ATENÇÃO]%s Folga apertada. Recomendo VPS dedicada à mídia (ou limitar/desligar\n' "$C_Y" "$C_0"
  echo "     o Ollama, que costuma ser o maior consumidor) antes de subir o VoIP."
fi
for n in "${notes[@]:-}"; do [[ -n "$n" ]] && echo "  - $n"; done

cat <<'TXT'

Referência rápida (VoIP interno, áudio opus passthrough):
  - CPU: ~1-3% de 1 núcleo por chamada interna; FreeSWITCH idle é leve.
  - RAM: FreeSWITCH ~150-300MB + coturn ~50MB.
  - Banda: ~80-100 kbps por sentido por chamada (a mídia passa pelo servidor).
  - Portas: liberar faixa UDP de RTP (ex.: 16384-32768) + TURN (3478) se houver NAT.
  Regra prática: cada chamada interna simultânea ~= 0,1 Mbps. 20 chamadas ~= 2 Mbps + ~1 núcleo.
TXT
