#!/usr/bin/env bash
# ==============================================================================
# exportar-clientes.sh — tira a base de clientes de uma empresa em CSV, só quem
# tem telefone utilizável. SÓ LEITURA.
#
# Colunas, na ordem que o sistema de destino aceita:
#
#     nome, telefone, cpf, email, nascimento
#
# ------------------------------------------------------------------------------
# O QUE ELE DECIDE, E POR QUÊ
#
# TELEFONE — cada cliente tem até três (`phone`, `whatsapp_phone`,
# `phone_secondary`). Vale o primeiro que sobreviver à limpeza, nessa ordem.
# Limpeza: só dígitos; tira o `55` do país quando sobra DDD+número; exige 10 ou
# 11 dígitos; recusa o que começa com 0 e o que é um dígito repetido. Telefone
# inventado no destino é pior que telefone ausente — e quem não tiver nenhum
# fica de fora, que foi o pedido.
#
# CPF — só quando tem 11 dígitos e o cadastro não diz que é CNPJ. Sai em
# dígitos, sem pontuação.
#
# DUPLICADOS — mesmo telefone é a mesma pessoa. Fica o registro mais completo
# (cpf, email, nascimento, nome) e, no empate, o mais recente. O relatório diz
# quantos foram unificados.
#
# NASCIMENTO — AAAA-MM-DD por padrão, que nenhum importador interpreta errado.
# `DATA_BR=1` troca para DD/MM/AAAA.
#
# ------------------------------------------------------------------------------
# DOIS ARQUIVOS, DE PROPÓSITO
#
#   clientes-<empresa>-<data>.csv         vírgula, UTF-8 — é o de IMPORTAR
#   clientes-<empresa>-<data>-excel.csv   ponto-e-vírgula + BOM — é o de OLHAR
#
# O Excel em português usa `;` como separador de lista e abre o CSV de vírgula
# tudo numa coluna só; e sem BOM ele mostra "São" como "SÃ£o". Já o importador
# do outro sistema quase sempre quer vírgula e estranha o BOM. Em vez de
# escolher errado, saem os dois.
#
# ------------------------------------------------------------------------------
# USO
#   bash exportar-clientes.sh                      # zito-oticas
#   bash exportar-clientes.sh outra-empresa
#   DATA_BR=1 bash exportar-clientes.sh            # nascimento DD/MM/AAAA
#   SEM_OPTOUT=1 bash exportar-clientes.sh         # tira quem pediu pra não
#                                                  # receber marketing
#   SEM_CABECALHO=1 bash exportar-clientes.sh      # sem a linha de títulos
#
# Roda no HOST Proxmox (tyr), como root. Os arquivos ficam em /root/exports/.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}
BANCO=${BANCO:-norty_vision}
EMPRESA=${1:-zito-oticas}
SAIDA=${SAIDA:-/root/exports}
DATA_BR=$([[ "${DATA_BR:-0}" == "1" ]] && echo sim || echo nao)
CABECALHO=$([[ "${SEM_CABECALHO:-0}" == "1" ]] && echo false || echo true)
SEM_OPTOUT=$([[ "${SEM_OPTOUT:-0}" == "1" ]] && echo sim || echo nao)

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s======>%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()    { printf '  %s[ok]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso() { printf '  %s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre() { printf '\n%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SQL_FONTE=${SQL_FONTE:-$AQUI/../sql/clientes-export.sql}
[[ -f "$SQL_FONTE" ]] || morre "não achei o SQL em $SQL_FONTE"

# --- guarda: o SQL não pode escrever em tabela de verdade -------------------
# A consulta cria duas views TEMPORÁRIAS (pra regra do telefone existir uma só
# vez) e por isso a sessão não pode começar somente-leitura. Então a conferência
# é aqui: qualquer escrita de verdade e o script nem roda.
if grep -nEi '^[[:space:]]*(insert|update|delete|drop|truncate|alter|grant|revoke)\b' "$SQL_FONTE"; then
  morre "o SQL de export tem comando de escrita (listado acima). Não vou rodar isso no banco de produção."
fi
grep -qE 'create temporary view' "$SQL_FONTE" || morre "o SQL não cria as views temporárias esperadas — confira $SQL_FONTE"
ok "o SQL de export não escreve nada (só views temporárias)"
[[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)"
command -v pct >/dev/null || morre "sem \`pct\` — este script roda no HOST Proxmox, não dentro do CT"

printf '  %s[ok]%s máquina: %s\n' "$C_OK" "$C_0" "$(hostname -s)"

TRAB=$(mktemp -d /tmp/export-clientes.XXXXXX); chmod 755 "$TRAB"
trap 'rm -rf "$TRAB"' EXIT
CARIMBO=$(date +%Y%m%d-%H%M%S)
BASE_NOME="clientes-$EMPRESA-$CARIMBO"

# --- o driver: inclui o SQL, escreve os dois arquivos e conta ---------------
cat > "$TRAB/driver.sql" <<DRIVER
\\set empresa '$EMPRESA'
\\set data_br '$DATA_BR'
\\set sem_optout '$SEM_OPTOUT'
\\i /tmp/clientes-export.sql

\\copy (select * from v_export) to '/tmp/$BASE_NOME.csv' with (format csv, header $CABECALHO)
\\copy (select * from v_export) to '/tmp/$BASE_NOME-excel.csv' with (format csv, header $CABECALHO, delimiter ';')

\\pset footer off
\\echo
\\echo '== CONTAS =================================================================='
select 'clientes ativos na base'            as o_que, count(*)::text as quantos
  from customers c join organizations o on o.id = c.organization_id
 where o.slug = '$EMPRESA' and c.deleted_at is null
union all select 'com telefone utilizável', count(*)::text from v_pessoas
union all select 'unificados (mesmo telefone)', count(*)::text from v_pessoas where pos > 1
union all select '>>> linhas no CSV', count(*)::text from v_export
union all select 'dos exportados: com cpf', count(*)::text from v_export where cpf is not null
union all select 'dos exportados: com email', count(*)::text from v_export where email is not null
union all select 'dos exportados: com nascimento', count(*)::text from v_export where nascimento is not null
union all select 'dos exportados: SEM nome', count(*)::text from v_export where nome = ''
union all select 'opt-out de marketing na base', count(*)::text
  from customers c join organizations o on o.id = c.organization_id
 where o.slug = '$EMPRESA' and c.deleted_at is null and c.opt_out_marketing;

-- Contato com telefone que NAO esta na base de clientes. Nao vai no CSV: o
-- pedido foi a base de CLIENTES. Aparece aqui porque "minha base toda" pode
-- ser maior do que `customers`, e isso e melhor saber agora que depois de
-- importar.
\echo
\echo '== FORA DO CSV (contato com telefone que nao e cliente) ===================='
with org as (select id from organizations where slug = '$EMPRESA'),
fones as (select telefone from v_pessoas),
lim as (
  select regexp_replace(coalesce(f.fone,''),'\\D','','g') as d, f.origem
    from (
      select phone as fone, 'lead do CRM' as origem from crm_lead where organization_id = (select id from org)
      union all
      select customer_phone, 'lead do catalogo' from catalog_leads where organization_id = (select id from org)
    ) f
)
select origem as o_que,
       count(distinct case when length(d) in (10,11) then d
                           when length(d) in (12,13) and left(d,2)='55' then substr(d,3) end)::text as quantos
  from lim
 where (length(d) in (10,11) or (length(d) in (12,13) and left(d,2)='55'))
   and coalesce(case when length(d) in (10,11) then d
                     when length(d) in (12,13) and left(d,2)='55' then substr(d,3) end, 'x')
       not in (select telefone from fones)
 group by origem order by 1;
DRIVER

log "gerando o CSV de $EMPRESA (banco $BANCO)"
chmod 644 "$SQL_FONTE" "$TRAB/driver.sql"
pct push "$CT" "$SQL_FONTE" /tmp/clientes-export.sql
pct push "$CT" "$TRAB/driver.sql" /tmp/driver.sql
pct exec "$CT" -- bash -c "docker cp /tmp/clientes-export.sql $CONTAINER:/tmp/clientes-export.sql && \
  docker cp /tmp/driver.sql $CONTAINER:/tmp/driver.sql"
pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
  docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
  psql -U postgres -d $BANCO -v ON_ERROR_STOP=1 -q -f /tmp/driver.sql"

# --- tira os arquivos de dentro do container e traz pro host ---------------
# `docker exec psql -f` escreve DENTRO do container: o /tmp dele não é o /tmp
# do CT (foi assim que o dump da transferência morreu). Então docker cp sempre.
mkdir -p "$SAIDA"
for f in "$BASE_NOME.csv" "$BASE_NOME-excel.csv"; do
  pct exec "$CT" -- bash -c "docker cp $CONTAINER:/tmp/$f /tmp/$f"
  pct pull "$CT" "/tmp/$f" "$SAIDA/$f"
  pct exec "$CT" -- bash -c "rm -f /tmp/$f; docker exec $CONTAINER rm -f /tmp/$f"
done
pct exec "$CT" -- bash -c "rm -f /tmp/clientes-export.sql /tmp/driver.sql; \
  docker exec $CONTAINER rm -f /tmp/clientes-export.sql /tmp/driver.sql" 2>/dev/null || true

# o BOM no arquivo do Excel: sem ele o Excel pt-BR mostra "São" como "SÃ£o"
printf '\xEF\xBB\xBF' | cat - "$SAIDA/$BASE_NOME-excel.csv" > "$SAIDA/$BASE_NOME-excel.tmp"
mv "$SAIDA/$BASE_NOME-excel.tmp" "$SAIDA/$BASE_NOME-excel.csv"

LINHAS=$(grep -c '' "$SAIDA/$BASE_NOME.csv" || true)
[[ "$CABECALHO" == "true" ]] && LINHAS=$(( LINHAS - 1 ))
[[ "$LINHAS" -ge 0 ]] || LINHAS=0
log "pronto"
ok "$SAIDA/$BASE_NOME.csv        ($LINHAS cliente(s)) — é o de IMPORTAR"
ok "$SAIDA/$BASE_NOME-excel.csv  — é o de OLHAR no Excel"
echo
echo "  primeiras linhas:"
head -4 "$SAIDA/$BASE_NOME.csv" | sed 's/^/    /'
cat <<TXT

  Para trazer pra sua máquina, do seu computador:

      scp root@tyr:$SAIDA/$BASE_NOME.csv .

  O arquivo tem nome, telefone, CPF, e-mail e nascimento de gente de verdade.
  Depois de importar, vale apagar a cópia: \`rm $SAIDA/$BASE_NOME*.csv\`.

TXT
