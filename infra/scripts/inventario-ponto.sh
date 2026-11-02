#!/usr/bin/env bash
# ==============================================================================
# inventario-ponto.sh — o que existe de ponto, escala e folha, em CADA banco do
# Postgres compartilhado. SÓ LEITURA.
#
# Serve pra planejar a transferência Norty Vision -> Norty RH sem adivinhar:
# ele acha sozinho quais bancos têm ponto (Vision e RH moram no mesmo Postgres,
# em bancos diferentes), e pra cada um mostra:
#
#   · as empresas que existem ali
#   · os funcionários do ponto COM CPF — o CPF é a chave que casa os dois lados,
#     porque os UUIDs são diferentes em cada banco
#   · quantas linhas tem cada tabela que entraria na transferência
#   · as batidas por mês, com o intervalo de datas e a faixa de NSR
#   · se a cadeia de hash tem começo (prev_hash nulo) por empregador
#
# Nada aqui escreve: `default_transaction_read_only = on` na primeira linha do
# SQL, e qualquer escrita acidental falha.
#
# USO
#   bash inventario-ponto.sh                 # empresa zito-oticas, todos os bancos
#   bash inventario-ponto.sh outra-empresa
#   BANCOS="norty_vision norty_rh" bash inventario-ponto.sh
#
# Roda no HOST Proxmox, como root.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}
EMPRESA=${1:-zito-oticas}

C_OK=$'\033[32m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s======>%s %s\n' "$C_AZ" "$C_0" "$*"; }
morre() { printf '%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || morre "precisa ser root (pct pede root)"
command -v pct >/dev/null || morre "sem \`pct\` — este script roda no HOST Proxmox, não dentro do CT"
printf '%s[OK]%s máquina: %s\n' "$C_OK" "$C_0" "$(hostname -s)"

# psql dentro do CT; a senha entra por variável de ambiente lá dentro e nunca
# aparece na linha de comando.
psql_ct() {
  local banco=$1; shift
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -i -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $banco $*"
}

# --- quais bancos têm ponto? ------------------------------------------------
# Sem isto eu teria que perguntar onde o RH mora. O Postgres responde.
if [[ -z "${BANCOS:-}" ]]; then
  log "procurando bancos com tabela de ponto"
  TODOS=$(psql_ct postgres -tAc "\"select datname from pg_database where not datistemplate and datallowconn order by datname\"" | tr -d '\r')
  BANCOS=""
  for b in $TODOS; do
    tem=$(psql_ct "$b" -tAc "\"select count(*) from information_schema.tables where table_schema='public' and table_name='ponto_punch'\"" 2>/dev/null | tr -d '[:space:]' || echo 0)
    if [[ "$tem" == "1" ]]; then
      BANCOS="$BANCOS $b"
      printf '  %s[tem ponto]%s %s\n' "$C_OK" "$C_0" "$b"
    else
      printf '  [sem ponto] %s\n' "$b"
    fi
  done
fi
[[ -n "${BANCOS// /}" ]] || morre "nenhum banco com \`ponto_punch\`. Passe explicitamente: BANCOS=\"a b\" bash $0"

SQL=$(mktemp /tmp/inv-ponto.XXXXXX.sql)
trap 'rm -f "$SQL"' EXIT
cat > "$SQL" <<'SQLFIM'
\set ON_ERROR_STOP on
set default_transaction_read_only = on;
set timezone = 'America/Sao_Paulo';
\pset footer off
\pset null ''

\echo '--- empresas neste banco ---'
select slug, name, status from organizations order by slug;

\echo
\echo '--- funcionarios do ponto (a chave do casamento e o CPF) ---'
select pe.name, coalesce(pe.cpf,'(sem cpf)') as cpf, pe.active,
       coalesce(pe.matricula,'') as matricula,
       pe.id as ponto_employee_id, coalesce(pe.employer_id::text,'(sem empregador)') as employer_id
  from ponto_employee pe
  join organizations o on o.id = pe.organization_id
 where o.slug = :'empresa'
 order by pe.active desc, pe.name;

\echo
\echo '--- o que existe pra transferir (linhas por tabela) ---'
select t as tabela,
       (xpath('/row/c/text()', query_to_xml(
          format('select count(*) as c from public.%I where organization_id = (select id from organizations where slug = %L)', t, :'empresa'),
          false, true, '')))[1]::text::bigint as linhas
  from unnest(array[
    'ponto_punch','ponto_employee','ponto_employer','ponto_device','ponto_config',
    'ponto_schedule','schedule_templates','schedule_slots','work_shifts',
    'ponto_schedule_override','ponto_holiday',
    'ponto_closing','ponto_bank_movement','ponto_bank_request',
    'ponto_justification','ponto_espelho_signature',
    'ponto_leave','ponto_vacation','ponto_allocation','ponto_shift_swap',
    'ponto_extra_shift','ponto_extra_punch','ponto_store_transfer','ponto_assiduidade',
    'ponto_schedule_plan','ponto_schedule_import','ponto_schedule_settings'
  ]) t
 where exists (select 1 from information_schema.columns
                where table_schema='public' and table_name=t and column_name='organization_id')
 order by 2 desc nulls last, 1;

\echo
\echo '--- batidas por mes (e o intervalo) ---'
select to_char(p.punched_at, 'YYYY-MM') as mes, count(*) as batidas,
       count(*) filter (where p.voided) as anuladas,
       min(p.punched_at)::date as primeira, max(p.punched_at)::date as ultima,
       min(p.nsr) as nsr_min, max(p.nsr) as nsr_max
  from ponto_punch p
  join organizations o on o.id = p.organization_id
 where o.slug = :'empresa'
 group by 1 order by 1;

\echo
\echo '--- a cadeia de hash fecha? (por empregador) ---'
select coalesce(p.employer_id::text,'(sem empregador)') as empregador,
       count(*) as batidas, min(p.nsr) as nsr_min, max(p.nsr) as nsr_max,
       count(*) filter (where p.prev_hash is null) as sem_prev_hash
  from ponto_punch p
  join organizations o on o.id = p.organization_id
 where o.slug = :'empresa'
 group by 1;
SQLFIM

pct push "$CT" "$SQL" /tmp/inv-ponto.sql
pct exec "$CT" -- bash -c "docker cp /tmp/inv-ponto.sql $CONTAINER:/tmp/inv-ponto.sql"

for b in $BANCOS; do
  log "BANCO: $b   (empresa: $EMPRESA)"
  pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
    docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
    psql -U postgres -d $b -q -v empresa='$EMPRESA' -f /tmp/inv-ponto.sql" || \
    printf '%s[!]%s o inventário falhou em %s (segue nos outros)\n' "$C_ER" "$C_0" "$b" >&2
done

pct exec "$CT" -- rm -f /tmp/inv-ponto.sql 2>/dev/null || true
pct exec "$CT" -- bash -c "docker exec $CONTAINER rm -f /tmp/inv-ponto.sql" 2>/dev/null || true

cat <<'TXT'

O que fazer com isso: me manda a saída inteira. Com ela eu monto a
transferência sabendo os nomes dos bancos, o CPF de cada lado (que é como os
dois se casam, já que os UUIDs são diferentes) e o volume real de cada tabela.

TXT
