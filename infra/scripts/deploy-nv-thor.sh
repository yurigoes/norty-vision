#!/usr/bin/env bash
# ==============================================================================
# deploy-nv-thor.sh — sobe o Norty Vision na thor (CT 105 · Asgard)
#
# RODA NA THOR, como root. Não confundir com:
#
#   /root/deploy-norty-vision.sh   ← NÃO É DEPLOY. É a migração única de 3/jul,
#                                     que faz `pg_restore --clean --if-exists`
#                                     e APAGA o banco de produção. Nunca rode.
#
# ------------------------------------------------------------------------------
# COMO ESTA MÁQUINA ESTÁ MONTADA
#
#   host thor:  /srv/apps-fase3/norty-vision      ← o código mora aqui
#   CT 105:     /opt/fase3/norty-vision           ← mesmo diretório, bind-mount
#   compose:    infra/docker/docker-compose.yml   ← sobe nv-api e nv-web
#   banco/etc:  CT 102 (192.168.15.72)            ← Postgres/Redis/MinIO shared
#
# Editar no host, buildar dentro do container. É a regra de ouro do cluster.
#
# ------------------------------------------------------------------------------
# O QUE NÃO PODE SER TOCADO  (e por isso este script existe)
#
# A pasta de produção NÃO é um clone git: é uma cópia extraída em julho, e
# depois dela foram criados ali arquivos que **não existem no repositório**:
#
#   infra/docker/docker-compose.yml   ← o compose que faz a produção rodar.
#                                       Não está versionado. Existe só aqui.
#   infra/docker/.env                 ← senhas do Postgres/Redis/MinIO
#   infra/docker/.env.norty           ← idem
#   infra/docker/.env.bak-*           ← backups de quando isso foi ajustado
#   infra/docker/docker-compose.norty.yml  ← editado localmente depois da cópia
#
# Um `rsync` ou `tar x` ingênuo por cima da pasta apaga todos eles e derruba a
# produção — sem erro nenhum na hora, só containers que não sobem depois.
#
# Por isso a sincronia aqui é POR LISTA: só o que o build precisa entra, e
# `infra/` inteiro fica de fora. Confirmado no repositório: nada em
# `infra/docker/` afeta o build (o contexto é a raiz, os Dockerfiles são
# `apps/api/Dockerfile` e `apps/web/Dockerfile`).
#
# ------------------------------------------------------------------------------
# USO
#
#   bash deploy-nv-thor.sh              # deploy da branch main
#   bash deploy-nv-thor.sh --dry-run    # mostra o que mudaria, sem tocar em nada
#   REF=alguma-branch bash deploy-nv-thor.sh
# ==============================================================================
set -euo pipefail

REF="${REF:-main}"
REPO="${REPO:-https://github.com/yurigoes/norty-vision.git}"
CT=105
DESTINO=/srv/apps-fase3/norty-vision
FONTE=/srv/apps-fase3/.norty-vision-src          # clone de verdade, com histórico
DENTRO_DO_CT=/opt/fase3/norty-vision
BACKUPS=/srv/apps-fase3/.norty-vision-backups

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_0=$'\033[0m'
log()  { printf '\n\033[34m==>\033[0m %s\n' "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso(){ printf '%s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre(){ printf '%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || morre "precisa ser root (pct e docker do CT pedem root)"
command -v pct >/dev/null || morre "sem \`pct\` — este script roda NA THOR, não dentro do CT"
[[ -d "$DESTINO" ]] || morre "$DESTINO não existe. Esta não é a máquina certa."

# --- 1. o que a produção tem e o repositório não ----------------------------
# Antes de qualquer escrita: prova de que os arquivos locais seguem lá.
INTOCAVEIS=(
  infra/docker/docker-compose.yml
  infra/docker/.env
)
log "conferindo os arquivos que só existem aqui"
for f in "${INTOCAVEIS[@]}"; do
  [[ -f "$DESTINO/$f" ]] || morre "$f sumiu de $DESTINO. Pare e investigue — sem ele a produção não sobe."
  printf '    %s\n' "$f"
done
ok "os arquivos locais estão no lugar"

# --- 2. backup ---------------------------------------------------------------
CARIMBO=$(date +%Y%m%d-%H%M%S)
DEST_BK="$BACKUPS/$CARIMBO"
if [[ $DRY -eq 0 ]]; then
  log "guardando uma cópia de infra/docker antes de mexer"
  mkdir -p "$DEST_BK"
  cp -a "$DESTINO/infra/docker" "$DEST_BK/docker"
  ok "backup em $DEST_BK/docker"
else
  aviso "--dry-run: pulando o backup"
fi

# --- 3. trazer o código do git ----------------------------------------------
# O clone fica SEPARADO da pasta de produção, de propósito: assim a produção
# nunca vira um repositório meio-git meio-cópia, e dá pra ver exatamente o que
# vai entrar antes de entrar.
log "buscando $REF do repositório"
if [[ -d "$FONTE/.git" ]]; then
  git -C "$FONTE" fetch --prune origin "$REF"
else
  aviso "primeiro deploy: clonando em $FONTE"
  [[ $DRY -eq 1 ]] && morre "--dry-run não clona. Rode uma vez sem --dry-run."
  git clone --origin origin "$REPO" "$FONTE"
  git -C "$FONTE" fetch origin "$REF"
fi
COMMIT=$(git -C "$FONTE" log -1 --format='%h %ad %s' --date=short "origin/$REF")
ok "vai subir: $COMMIT"

# O código sai por `git archive` num diretório temporário, NÃO por checkout.
#
# A primeira versão daqui fazia `git checkout --detach origin/$REF` dentro de
# $FONTE — e como este script vive numa branch que não é a `main`, o checkout
# APAGAVA O PRÓPRIO SCRIPT do disco. Rodou uma vez e sumiu.
#
# `git archive` não move o HEAD nem toca no diretório de trabalho: o clone fica
# exatamente onde você o deixou, com o script no lugar. E o que vai pra
# produção sai do objeto do git, não de uma árvore que alguém pode ter sujado.
ARVORE="$(mktemp -d /tmp/nv-deploy.XXXXXX)"
trap 'rm -rf "$ARVORE"' EXIT
git -C "$FONTE" archive "origin/$REF" | tar -x -C "$ARVORE"

# --- 4. sincronizar SÓ o que o build precisa ---------------------------------
# Lista explícita. `infra/` fora — é onde moram o compose e os .env locais.
CAMINHOS=(
  apps
  packages
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  turbo.json
  .dockerignore
)
# --- 4a. o que existe SÓ na produção -----------------------------------------
#
# Achado rodando o primeiro ensaio: a produção tinha código que NUNCA esteve no
# git — um módulo `api/src/collab/` inteiro e a tela `agenda/recepcao`, escritos
# direto na thor e nunca commitados. Com `--delete`, o deploy os apagaria; o
# build passaria; e a funcionalidade sumiria sem uma linha de erro.
#
# Então antes de escrever qualquer coisa: descobrir o que sumiria, separar o
# que é lixo conhecido do que é código, e PARAR se for código.
DESCARTAVEIS='\.bak($|-)|\.bak-|~$|\.orig$|\.rej$|\.swp$'
declare -a SOME_CODIGO=() SOME_LIXO=()

log "vendo o que a sincronia apagaria"
for c in "${CAMINHOS[@]}"; do
  [[ -d "$ARVORE/$c" ]] || continue
  while IFS= read -r linha; do
    alvo="${linha#*deleting}"; alvo="${alvo#"${alvo%%[![:space:]]*}"}"   # tira o rótulo e os espaços
    [[ -n "$alvo" && "$alvo" != */ ]] || continue
    if [[ "$alvo" =~ $DESCARTAVEIS ]]; then
      SOME_LIXO+=("$c/$alvo")
    else
      SOME_CODIGO+=("$c/$alvo")
    fi
  done < <(rsync -an --delete --out-format='%i %n' "$ARVORE/$c/" "$DESTINO/$c/" 2>/dev/null | grep '^\*deleting' || true)
done

if [[ ${#SOME_LIXO[@]} -gt 0 ]]; then
  printf '    (%d arquivo(s) de backup/rascunho, some sem dó)\n' "${#SOME_LIXO[@]}"
fi

if [[ ${#SOME_CODIGO[@]} -gt 0 ]]; then
  aviso "ATENÇÃO: ${#SOME_CODIGO[@]} arquivo(s) de CÓDIGO existem só aqui e sumiriam:"
  printf '      %s\n' "${SOME_CODIGO[@]}" >&2
  if [[ "${PERMITIR_REMOCOES:-0}" != "1" ]]; then
    cat >&2 <<FIM

  Isto é código que não está no repositório — escrito direto na produção e
  nunca commitado. Apagar significa perder a funcionalidade, e o build ainda
  vai passar, então ninguém percebe na hora.

  Decida antes de seguir:

    · em uso  → traga pro git primeiro (commit + push), e rode de novo;
    · morto   → PERMITIR_REMOCOES=1 bash $0 ${DRY:+--dry-run}

FIM
    morre "parando de propósito. Nada foi alterado."
  fi
  aviso "PERMITIR_REMOCOES=1 — seguindo e apagando os arquivos acima."
fi

log "sincronizando o código (infra/ e docs/ ficam de fora)"
RSYNC_ARGS=(-a --delete --human-readable --info=stats2)
[[ $DRY -eq 1 ]] && RSYNC_ARGS+=(--dry-run --itemize-changes)
for c in "${CAMINHOS[@]}"; do
  [[ -e "$ARVORE/$c" ]] || { aviso "$c não existe no repositório — pulando"; continue; }
  if [[ -d "$ARVORE/$c" ]]; then
    rsync "${RSYNC_ARGS[@]}" "$ARVORE/$c/" "$DESTINO/$c/"
  else
    rsync "${RSYNC_ARGS[@]}" "$ARVORE/$c" "$DESTINO/$c"
  fi
done

# --- 5. os arquivos locais continuam lá? -------------------------------------
# A rede de segurança do passo 1, agora depois da escrita. Se o rsync tiver
# comido alguma coisa, isso aparece AQUI e não daqui a três dias.
log "conferindo de novo os arquivos locais"
for f in "${INTOCAVEIS[@]}"; do
  [[ -f "$DESTINO/$f" ]] || morre "A SINCRONIA APAGOU $f. Restaure de $DEST_BK/docker e não suba nada."
done
ok "intactos"

if [[ $DRY -eq 1 ]]; then
  log "--dry-run: nada foi alterado, nada foi buildado."
  exit 0
fi

# --- 6. rebuild dentro do CT -------------------------------------------------
log "rebuildando nv-api e nv-web no CT $CT"
pct exec "$CT" -- bash -c "cd $DENTRO_DO_CT/infra/docker && docker compose up -d --build"

# --- 7. conferir -------------------------------------------------------------
log "estado dos containers"
pct exec "$CT" -- docker ps --filter name=nv- --format '    {{.Names}}\t{{.Status}}'

log "esperando ficarem saudáveis"
saudavel=0
for _ in $(seq 1 30); do
  n=$(pct exec "$CT" -- docker ps --filter name=nv- --filter health=healthy -q 2>/dev/null | wc -l)
  [[ "$n" -ge 2 ]] && { saudavel=1; break; }
  sleep 5
done
if [[ "$saudavel" == "1" ]]; then
  ok "nv-api e nv-web saudáveis"
else
  aviso "não ficaram saudáveis em 150s. Veja:"
  aviso "  pct exec $CT -- docker logs --tail 80 nv-api"
  aviso "  pct exec $CT -- docker logs --tail 80 nv-web"
fi

log "subiu: $COMMIT"
cat <<FIM

Confira na tela, que é o que o roteiro manual não alcança daqui:

  1. https://vision.norty.com.br  — entrar como dono de empresa
  2. entrar como master e passar pelas telas do painel do SaaS

  Esta versão FECHA 113 rotas de propósito: o master sem impersonar deixa de
  ler dado de empresa. As 19 telas do painel foram conferidas, mas uma que
  tenha escapado responde 403 — o conserto é \`@SemEmpresa()\` no handler.

Se precisar voltar atrás, o backup de infra/docker está em:
  $DEST_BK/docker
e o código anterior sai do próprio git ($FONTE), com REF=<commit-anterior>.

FIM
