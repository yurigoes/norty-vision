#!/usr/bin/env bash
# ==============================================================================
# create-master.sh - cria o primeiro master (platform_user) do yugo-platform
#
# Pergunta email/nome/senha interativamente. Senha NAO ecoa no terminal.
# Roda 'dist/scripts/create-master.js' dentro do container yugo-api.
#
# Idempotente: rodar de novo com mesmo email atualiza senha.
# ==============================================================================

set -euo pipefail

readonly C_RESET=$'\033[0m'
readonly C_GREEN=$'\033[32m'
readonly C_BLUE=$'\033[34m'
log() { printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()  { printf '%s[OK]%s %s\n'  "$C_GREEN" "$C_RESET" "$*"; }

# verifica container
if ! docker ps --format '{{.Names}}' | grep -q '^yugo-api$'; then
  echo "ERRO: container yugo-api nao esta rodando. Suba o stack primeiro." >&2
  exit 1
fi

# input email
read -p "Email do master: " email
[[ -n "$email" ]] || { echo "Email vazio."; exit 2; }

# input nome
read -p "Nome do master: " name
[[ -n "$name" ]] || { echo "Nome vazio."; exit 2; }

# input senha sem echo
read -s -p "Senha (min 12 caracteres): " password
echo
[[ ${#password} -ge 12 ]] || { echo "Senha precisa de 12+ caracteres."; exit 2; }
read -s -p "Repita a senha: " password2
echo
[[ "$password" == "$password2" ]] || { echo "Senhas nao batem."; exit 2; }

log "Criando/atualizando master no banco..."

docker exec -i \
  -e MASTER_EMAIL="$email" \
  -e MASTER_NAME="$name" \
  -e MASTER_PASSWORD="$password" \
  yugo-api node dist/scripts/create-master.js

ok "Concluido. Faca login em https://yugochat.com.br/master-login (em construcao)"
ok "Por enquanto, login do master via API: POST /api/platform-auth/login"
