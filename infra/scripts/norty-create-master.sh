#!/usr/bin/env bash
# Cria o master (platform_user) do Norty Vision (container nv-api).
# Senha NÃO ecoa. Idempotente: rodar de novo com mesmo email atualiza a senha.
set -euo pipefail
docker ps --format '{{.Names}}' | grep -q '^nv-api$' || { echo "nv-api não está rodando"; exit 1; }
read -p "Email do master: " email; [[ -n "$email" ]] || { echo "vazio"; exit 2; }
read -p "Nome do master: " name; [[ -n "$name" ]] || { echo "vazio"; exit 2; }
read -s -p "Senha (min 12): " pw; echo; [[ ${#pw} -ge 12 ]] || { echo "min 12"; exit 2; }
read -s -p "Repita a senha: " pw2; echo; [[ "$pw" == "$pw2" ]] || { echo "não batem"; exit 2; }
docker exec -i -e MASTER_EMAIL="$email" -e MASTER_NAME="$name" -e MASTER_PASSWORD="$pw" nv-api node dist/scripts/create-master.js
echo "OK. Login: https://vision.norty.com.br/login -> 'Acessar como master da plataforma'"
