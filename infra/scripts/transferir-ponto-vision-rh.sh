#!/usr/bin/env bash
# ==============================================================================
# transferir-ponto-vision-rh.sh — leva ponto, escalas e folha de UMA empresa do
# Norty Vision para o Norty RH.
#
# Os dois sistemas moram no MESMO Postgres (CT 102), em bancos diferentes, e as
# tabelas de ponto têm a MESMA forma nos dois — então isto é cópia com
# remapeamento de id, não conversão.
#
# ------------------------------------------------------------------------------
# A DECISÃO QUE GOVERNA TUDO: AS BATIDAS FICAM IDÊNTICAS
#
# O hash da cadeia (Portaria 671) é
#
#     sha256( prev_hash | nsr | UUID_do_ponto_employee | punched_at ISO | O )
#
# nos dois sistemas — ou seja, depende do UUID do funcionário. Para as batidas
# continuarem válidas no RH, o funcionário no RH tem que ter o MESMO UUID do
# Vision. Então este script APAGA o cadastro de ponto que você criou no RH
# (casando por CPF) e recria com o UUID do Vision, mantendo o vínculo com a
# ficha de RH (`hr_employee_id`) que já existe lá.
#
# Só apaga cadastro de ponto SEM batida. Com batida, para e explica: apagar
# seria destruir registro de jornada.
#
# ------------------------------------------------------------------------------
# O QUE É REMAPEADO, E POR QUÊ
#
# As chaves estrangeiras de destino dizem o que pode viajar e o que não pode.
# O script lê `pg_constraint` do RH e decide coluna por coluna:
#
#   aponta pra organizations  -> troca pelo UUID da empresa no RH
#   aponta pra employees      -> casa por CPF com a ficha de RH de lá
#   aponta pra stores/users   -> vira NULL (são ids do Vision, não existem no RH)
#   qualquer outra            -> vai como está (ponto_employee, ponto_employer,
#                                ponto_device e afins viajam com o id original)
#
# Se uma coluna PRECISA ser anulada mas é NOT NULL, a tabela é pulada com aviso
# em vez de estourar no meio.
#
# ------------------------------------------------------------------------------
# SEGURANÇA
#
#   · `--ensaio` mostra o plano e as contagens e NÃO escreve nada.
#   · dump do banco do RH antes de qualquer escrita (a não com SEM_BACKUP=1).
#   · tudo numa transação só: falha no meio não deixa metade.
#   · idempotente: os ids são preservados, e a inserção é
#     `on conflict (id) do nothing`. Rodar duas vezes não duplica.
#   · no fim, RECONFERE A CADEIA de hash no RH do mesmo jeito que a API faz.
#
# USO
#   bash transferir-ponto-vision-rh.sh --ensaio
#   bash transferir-ponto-vision-rh.sh
#   EMPRESA=outra-empresa BANCO_RH=norty_rh bash transferir-ponto-vision-rh.sh
#
# Roda no HOST Proxmox (tyr), como root. MODO=local usa o psql da própria
# máquina — é assim que este script foi ensaiado antes de existir.
# ==============================================================================
set -euo pipefail

CT=${CT:-102}
CONTAINER=${CONTAINER:-shared-postgres}
INFRA=${INFRA:-/opt/norty-shared-infra}
VISION=${BANCO_VISION:-norty_vision}
RH=${BANCO_RH:-}
EMPRESA=${EMPRESA:-zito-oticas}
MODO=${MODO:-auto}
ENSAIO=0; [[ "${1:-}" == "--ensaio" ]] && ENSAIO=1

C_OK=$'\033[32m'; C_AV=$'\033[33m'; C_ER=$'\033[31m'; C_AZ=$'\033[34m'; C_0=$'\033[0m'
log()   { printf '\n%s======>%s %s\n' "$C_AZ" "$C_0" "$*"; }
ok()    { printf '  %s[ok]%s %s\n' "$C_OK" "$C_0" "$*"; }
aviso() { printf '  %s[!]%s %s\n' "$C_AV" "$C_0" "$*" >&2; }
morre() { printf '\n%s[ERRO]%s %s\n' "$C_ER" "$C_0" "$*" >&2; exit 1; }

TRAB=$(mktemp -d /tmp/transf-ponto.XXXXXX)
chmod 755 "$TRAB"
trap 'rm -rf "$TRAB"' EXIT

[[ "$MODO" == "auto" ]] && { command -v pct >/dev/null && MODO=producao || MODO=local; }

# --- um jeito só de falar com o banco, nos dois modos -----------------------
# O SQL vai sempre por ARQUIVO, nunca por string: aspas aninhadas em três
# camadas (bash -> pct -> docker -> psql) é como se perde um dia.
roda_sql() { # roda_sql <banco> <arquivo> [args extra do psql...]
  local banco=$1 arq=$2; shift 2
  chmod 644 "$arq"
  if [[ "$MODO" == "producao" ]]; then
    pct push "$CT" "$arq" "/tmp/$(basename "$arq")"
    pct exec "$CT" -- bash -c "docker cp /tmp/$(basename "$arq") $CONTAINER:/tmp/$(basename "$arq")"
    pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
      docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
      psql -U postgres -d $banco -v ON_ERROR_STOP=1 $* -f /tmp/$(basename "$arq")"
  else
    su postgres -c "psql -d $banco -v ON_ERROR_STOP=1 $* -f $arq"
  fi
}
um_valor() { # um_valor <banco> <sql>
  local banco=$1 sql=$2 arq="$TRAB/q.sql"
  printf '%s\n' "$sql" > "$arq"
  roda_sql "$banco" "$arq" -tAq 2>/dev/null | tr -d '\r' | head -1
}

# ============================================================================
# QUAL BANCO É O DESTINO: isto NÃO se adivinha.
#
# No Postgres da tyr existem TRÊS bancos com `ponto_punch`: `yugoplatform`
# (esquema antigo, sem nem a coluna `employer_id`), `yugoponto` (o Norty RH de
# hoje) e `yugoponto_training`. E a empresa `zito-oticas` existe em mais de um
# deles. A primeira versão disto escolhia o primeiro candidato que achava — e
# teria mirado no `yugoplatform`, que é um banco antigo com uma Zito suspensa
# dentro.
#
# Então: se houver mais de um candidato, o script PARA e lista. Escolher por
# ordem alfabética não é descoberta, é sorte.
# ============================================================================
if [[ -z "$RH" ]]; then
  log "procurando o banco de destino"
  CANDIDATOS=""
  for b in $(um_valor postgres "select string_agg(datname,' ') from pg_database where not datistemplate and datallowconn"); do
    [[ "$b" == "$VISION" ]] && continue
    tem=$(um_valor "$b" "select count(*) from information_schema.columns where table_schema='public' and table_name='ponto_punch' and column_name='employer_id'")
    [[ "$tem" == "1" ]] || continue
    temorg=$(um_valor "$b" "select count(*) from organizations where slug = '$EMPRESA'")
    [[ "$temorg" == "1" ]] || continue
    CANDIDATOS="$CANDIDATOS $b"
    printf '  candidato: %s\n' "$b"
  done
  n=$(echo "$CANDIDATOS" | wc -w)
  if [[ "$n" == "1" ]]; then
    RH=${CANDIDATOS// /}
    ok "só um candidato: $RH"
  elif [[ "$n" == "0" ]]; then
    morre "nenhum banco com ponto novo (ponto_punch.employer_id) e a empresa \`$EMPRESA\`.
  Passe explicitamente: BANCO_RH=nome bash $0"
  else
    morre "mais de um banco serve como destino:$CANDIDATOS
  Não vou escolher por você — um deles é esquema antigo ou base de treino.
  Diga qual:  BANCO_RH=yugoponto bash $0"
  fi
fi
[[ -n "$RH" ]] || morre "não achei o banco do RH. Passe explicitamente: BANCO_RH=nome bash $0"
[[ "$RH" != "$VISION" ]] || morre "origem e destino são o mesmo banco ($RH)"

log "origem: $VISION   destino: $RH   empresa: $EMPRESA   modo: $MODO"

# --- as duas empresas -------------------------------------------------------
ORG_VI=$(um_valor "$VISION" "select id from organizations where slug = '$EMPRESA'")
ORG_RH=$(um_valor "$RH"     "select id from organizations where slug = '$EMPRESA'")
[[ -n "$ORG_VI" ]] || morre "a empresa \`$EMPRESA\` não existe em $VISION"
[[ -n "$ORG_RH" ]] || morre "a empresa \`$EMPRESA\` não existe em $RH — crie lá primeiro"
ok "Vision: $ORG_VI"
ok "RH:     $ORG_RH"

# --- as batidas que já existem no destino -----------------------------------
# Reexecutar é seguro: os ids são preservados e a inserção é
# `on conflict (id) do nothing`. E colisão de NSR com batida de OUTRO
# empregador não existe — a unicidade no RH é (employer_id, nsr), e o
# empregador que vai entrar tem o UUID do Vision, que é novo lá. Então aqui só
# se RELATA o que já está no destino, não se barra nada.
EMPREGADOR_VI=$(um_valor "$VISION" "select id from ponto_employer where organization_id = '$ORG_VI' order by is_default desc, created_at limit 1")
[[ -n "$EMPREGADOR_VI" ]] || morre "a empresa não tem empregador cadastrado no Vision — sem ele as batidas não têm cadeia"
JA_NO_RH=$(um_valor "$RH" "select count(*) from ponto_punch where employer_id = '$EMPREGADOR_VI'")
OUTRAS_NO_RH=$(um_valor "$RH" "select count(*) from ponto_punch where organization_id = '$ORG_RH' and (employer_id is distinct from '$EMPREGADOR_VI')")
NO_VISION=$(um_valor "$VISION" "select count(*) from ponto_punch where organization_id = '$ORG_VI'")
ok "batidas no Vision: $NO_VISION"
[[ "${JA_NO_RH:-0}" == "0" ]] && ok "o RH ainda não tem nenhuma dessas" || aviso "o RH já tem $JA_NO_RH batida(s) deste empregador — reexecução, não vai duplicar"
[[ "${OUTRAS_NO_RH:-0}" == "0" ]] || aviso "o RH tem $OUTRAS_NO_RH batida(s) de OUTRO empregador nessa empresa — não colidem, mas confira se era esperado"

# --- a cadeia de hash, do mesmo jeito que a API confere ---------------------
# Refaz sha256( prev | nsr | employee_id | punched_at ISO | source ) por
# empregador, na ordem do NSR. Serve pros DOIS bancos: antes de transferir
# precisa-se saber se ela JÁ fecha na origem — se não fecha, a transferência
# leva o problema como está, e isso não pode ser lido como "o script quebrou".
confere_cadeia() { # confere_cadeia <banco> <employer_id> -> "batidas|hash_fora|elo_fora|primeiro_ruim"
  local banco=$1 emp=$2
  cat > "$TRAB/cadeia.sql" <<SQL
with recursive ord as (
  select nsr, employee_id, punched_at, source, prev_hash, hash,
         row_number() over (order by nsr) as rn
    from ponto_punch where employer_id = '$emp'
), ch as (
  select o.rn, o.nsr, o.hash, o.prev_hash is null as elo_ok,
         encode(sha256(('' || '|' || o.nsr || '|' || o.employee_id || '|' ||
           to_char(o.punched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || o.source)::bytea),'hex') as esperado
    from ord o where o.rn = 1
  union all
  select o.rn, o.nsr, o.hash, o.prev_hash = c.hash,
         encode(sha256((c.hash || '|' || o.nsr || '|' || o.employee_id || '|' ||
           to_char(o.punched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || o.source)::bytea),'hex')
    from ch c join ord o on o.rn = c.rn + 1
)
select count(*) || '|' || count(*) filter (where hash <> esperado)
    || '|' || count(*) filter (where not elo_ok)
    || '|' || coalesce(min(nsr) filter (where hash <> esperado or not elo_ok)::text, '-')
  from ch;
SQL
  roda_sql "$banco" "$TRAB/cadeia.sql" -tAq 2>/dev/null | tr -d '\r' | head -1
}

# --- os funcionários, casados por CPF ---------------------------------------
# O CPF é a única chave que atravessa os dois bancos. Sem CPF dos dois lados
# não há casamento possível, e inventar um seria pior que parar.
log "casando os funcionários por CPF"
cat > "$TRAB/casamento.sql" <<SQL
\pset footer off
select pe.name, coalesce(pe.cpf,'(sem cpf)') as cpf, pe.id as uuid_vision,
       (select count(*) from ponto_punch p where p.employee_id = pe.id) as batidas
  from ponto_employee pe
 where pe.organization_id = '$ORG_VI'
 order by pe.name;
SQL
roda_sql "$VISION" "$TRAB/casamento.sql"

SEM_CPF=$(um_valor "$VISION" "select count(*) from ponto_employee where organization_id = '$ORG_VI' and coalesce(nullif(regexp_replace(cpf,'\\D','','g'),''),'') = ''")
[[ "${SEM_CPF:-0}" == "0" ]] || morre "$SEM_CPF funcionário(s) do ponto no Vision sem CPF — preencha lá antes, senão não há como casar com a ficha do RH"

# para cada CPF do Vision: existe ficha de RH (employees) no destino?
cat > "$TRAB/faltam.sql" <<SQL
\pset footer off
\pset tuples_only on
select '  sem ficha no RH: ' || pe.name || '  (cpf ' || pe.cpf || ')'
  from ponto_employee pe
 where pe.organization_id = '$ORG_VI';
SQL
CPFS_VI=$(um_valor "$VISION" "select string_agg(distinct regexp_replace(cpf,'\\D','','g'), ',') from ponto_employee where organization_id = '$ORG_VI'")
FALTAM=$(um_valor "$RH" "with alvo as (select unnest(string_to_array('$CPFS_VI', ',')) as cpf)
 select coalesce(string_agg(a.cpf, ', '), '')
   from alvo a
  where not exists (select 1 from employees e
                     where e.organization_id = '$ORG_RH'
                       and regexp_replace(coalesce(e.cpf,''),'\\D','','g') = a.cpf)")
if [[ -n "${FALTAM// /}" ]]; then
  aviso "sem ficha de RH no destino para o(s) CPF(s): $FALTAM"
  aviso "o cadastro de ponto entra do mesmo jeito, só fica sem vínculo com a ficha (hr_employee_id nulo)"
fi

# --- o que o destino já tem, e que a transferência não resolve --------------
log "o que o RH já tem dessa empresa"

FICHAS_VI=$(um_valor "$VISION" "select count(*) from employees where organization_id = '$ORG_VI'")
FICHAS_RH=$(um_valor "$RH"     "select count(*) from employees where organization_id = '$ORG_RH'")
printf '  fichas de RH (employees): Vision %s | RH %s\n' "${FICHAS_VI:-?}" "${FICHAS_RH:-?}"
if [[ "${FICHAS_RH:-0}" == "0" ]]; then
  aviso "o RH não tem NENHUMA ficha (employees) dessa empresa."
  aviso "Sem ficha não há como casar por CPF, e as tabelas que apontam pra ela — a"
  aviso "ESCALA (work_shifts) entre elas — vão ser PULADAS. Cadastre as fichas no RH"
  aviso "antes, ou aceite transferir sem a escala."
fi

EMPREGADORES_RH=$(um_valor "$RH" "select count(*) from ponto_employer where organization_id = '$ORG_RH'")
if [[ "${EMPREGADORES_RH:-0}" != "0" ]]; then
  aviso "o RH já tem $EMPREGADORES_RH empregador(es) nessa empresa, e o do Vision entra por cima"
  aviso "(com o UUID de lá, porque a cadeia de hash é por empregador). Depois o RH fica com"
  aviso "os dois: as batidas transferidas ficam no do Vision, e cada funcionário aponta pro dele."
  aviso "Veja em Empregadores se o antigo deve ser desativado."
fi

CFG_VI=$(um_valor "$VISION" "select count(*) from ponto_config where organization_id = '$ORG_VI'")
CFG_RH=$(um_valor "$RH"     "select count(*) from ponto_config where organization_id = '$ORG_RH'")
if [[ "${CFG_VI:-0}" != "0" && "${CFG_RH:-0}" != "0" ]]; then
  aviso "as DUAS bases têm config de ponto dessa empresa, e a config NÃO viaja"
  aviso "(organization_id é UNIQUE nela). A do RH continua valendo. Compare na tela:"
  aviso "tolerância, horário noturno, CNPJ do empregador e política de feriado mudam"
  aviso "o espelho — se divergirem, o espelho no RH não vai dar igual ao do Vision."
fi

CONFERIR=(stores ponto_employee ponto_employer ponto_device ponto_punch ponto_schedule work_shifts
          ponto_holiday ponto_closing ponto_bank_movement ponto_bank_request
          ponto_justification ponto_espelho_signature ponto_leave ponto_vacation
          ponto_extra_shift ponto_extra_punch ponto_assiduidade ponto_schedule_override)

declare -A ANTES=()
# o alvo de cada tabela: quantas linhas DEVEM chegar. Normalmente é o que saiu;
# onde o filtro de funcionário corta, é o que sobra depois do filtro.
declare -A ESPERADO=()
for t in "${CONFERIR[@]}"; do
  existe=$(um_valor "$RH" "select count(*) from information_schema.columns where table_schema='public' and table_name='$t' and column_name='organization_id'")
  [[ "$existe" == "1" ]] || continue
  ANTES[$t]=$(um_valor "$RH" "select count(*) from $t where organization_id = '$ORG_RH'")
done

# --- a cadeia JÁ fecha na origem? -------------------------------------------
log "conferindo a cadeia de hash NO VISION, antes de mexer em nada"
CADEIA_VI=$(confere_cadeia "$VISION" "$EMPREGADOR_VI")
IFS='|' read -r CV_N CV_H CV_E CV_P <<< "$CADEIA_VI"
printf '  %s batida(s) | %s hash fora | %s elo fora | primeiro problema no NSR %s\n' "${CV_N:-?}" "${CV_H:-?}" "${CV_E:-?}" "${CV_P:-?}"
if [[ "${CV_H:-1}" == "0" && "${CV_E:-1}" == "0" ]]; then
  ok "a cadeia fecha no Vision — se fechar no RH depois, a transferência preservou tudo"
else
  aviso "A CADEIA JÁ NÃO FECHA NO VISION. A transferência leva as batidas como estão,"
  aviso "então ela vai aparecer igualmente quebrada no RH — não será o script."
  aviso "Guarde este número ($CV_H hash fora, $CV_E elo fora, a partir do NSR $CV_P) pra comparar depois."
fi

# --- o que viaja, em ordem de dependência -----------------------------------
# `stores` entra porque `schedule_templates.store_id` e `schedule_slots.store_id`
# são NOT NULL e apontam pra lá: sem as lojas, as duas tabelas de escala — que
# foram justamente o que se pediu — seriam puladas.
TABELAS=(
  stores
  ponto_employer
  ponto_employee
  ponto_device
  # a escala do ponto é ponto_schedule (a definição: código, padrão, tolerância,
  # noturno) + work_shifts (o turno de cada dia de cada funcionário) +
  # ponto_schedule_plan/import (a planilha). `schedule_templates` e
  # `schedule_slots` NÃO entram: são a agenda de profissionais da ótica
  # (capacidade, bloqueio, duração de atendimento), outra coisa com nome
  # parecido.
  ponto_schedule work_shifts
  ponto_schedule_plan ponto_schedule_import ponto_schedule_settings
  ponto_schedule_override ponto_holiday
  # `ponto_config` NÃO viaja. `organization_id` é UNIQUE nela, e o RH já tem a
  # própria config dessa empresa — então `on conflict do nothing` deixaria a
  # do RH valendo e a do Vision de fora, calado. Config decide tolerância,
  # noturno, CNPJ do empregador e como o espelho é calculado: isso é decisão
  # de tela, não de script. O aviso no fim manda comparar as duas.
  ponto_punch
  ponto_closing ponto_bank_movement ponto_bank_request
  ponto_justification ponto_espelho_signature
  ponto_leave ponto_vacation ponto_allocation ponto_shift_swap
  ponto_extra_shift ponto_extra_punch ponto_assiduidade
  ponto_store_transfer
)
# `IFS="','"` NÃO serve aqui: o join usa só o PRIMEIRO caractere do IFS, e sai
# `a'b'c` em vez de `'a','b','c'`. Com printf não tem como errar.
LISTA_SQL="array[$(printf "'%s'," "${TABELAS[@]}" | sed 's/,$//')]"

log "lendo os dois catálogos (colunas e chaves estrangeiras)"
cat > "$TRAB/cat-destino.sql" <<SQL
select c.table_name || '|' || c.column_name || '|' || c.is_nullable
         || '|' || (case when c.column_default is null then 'sem_default' else 'tem_default' end)
         || '|' || coalesce((select cl.relname from pg_constraint con
                   join pg_class cl on cl.oid = con.confrelid
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
                  where con.contype = 'f' and con.conrelid = format('public.%I', c.table_name)::regclass
                    and a.attname = c.column_name limit 1), '')
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = any($LISTA_SQL)
 order by c.table_name, c.ordinal_position;
SQL
roda_sql "$RH" "$TRAB/cat-destino.sql" -tAq > "$TRAB/destino.txt"

cat > "$TRAB/cat-origem.sql" <<SQL
select table_name || '|' || column_name from information_schema.columns
 where table_schema = 'public' and table_name = any($LISTA_SQL)
 order by table_name, ordinal_position;
SQL
roda_sql "$VISION" "$TRAB/cat-origem.sql" -tAq > "$TRAB/origem.txt"
ok "destino: $(grep -c . "$TRAB/destino.txt") colunas | origem: $(grep -c . "$TRAB/origem.txt") colunas"

# --- o mapa de fichas de RH (employees), por CPF -----------------------------
# Só a `ponto_shift_swap` aponta pra `employees`, e precisa do id DE LÁ.
cat > "$TRAB/mapa-rh.sql" <<SQL
select regexp_replace(coalesce(cpf,''),'\\D','','g') || '|' || id
  from employees where organization_id = '$ORG_RH'
   and coalesce(nullif(regexp_replace(coalesce(cpf,''),'\\D','','g'),''),'') <> '';
SQL
roda_sql "$RH" "$TRAB/mapa-rh.sql" -tAq > "$TRAB/mapa-rh.txt"

cat > "$TRAB/mapa-vi.sql" <<SQL
select regexp_replace(coalesce(cpf,''),'\\D','','g') || '|' || id
  from employees where organization_id = '$ORG_VI'
   and coalesce(nullif(regexp_replace(coalesce(cpf,''),'\\D','','g'),''),'') <> '';
SQL
roda_sql "$VISION" "$TRAB/mapa-vi.sql" -tAq > "$TRAB/mapa-vi.txt" || : > "$TRAB/mapa-vi.txt"

# --- monta o SQL dos dois lados ---------------------------------------------
# Em awk de propósito: está num host Proxmox, e awk existe em qualquer lugar.
# A regra é a mesma pra toda tabela, e sai dos catálogos — nada cravado.
log "montando a carga"
awk -v org_vi="$ORG_VI" -v org_rh="$ORG_RH" -v ordem="${TABELAS[*]}" -v trab="$TRAB" '
function literal(v) { return "\x27" v "\x27" }
# Defesa em profundidade: qualquer ruido que chegue nestes arquivos NAO pode
# virar uuid. Foi assim que o eco do pset (a linha que diz que o formato de
# saida mudou) virou um CPF presente nos DOIS mapas: o casamento por CPF achou
# par e o SQL gerado saiu com um uuid de lixo no meio de um CASE. Invalido, e
# calado ate a hora de aplicar.
function uuid_ok(v) { return v ~ /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ }
function so_digitos(v) { return v ~ /^[0-9]+$/ }
FILENAME ~ /mapa-vi\.txt$/ { if (split($0, a, "|") == 2 && so_digitos(a[1]) && uuid_ok(a[2])) vi_cpf[a[1]] = a[2]; next }
FILENAME ~ /mapa-rh\.txt$/ { if (split($0, a, "|") == 2 && so_digitos(a[1]) && uuid_ok(a[2])) rh_cpf[a[1]] = a[2]; next }
FILENAME ~ /origem\.txt$/  { if (split($0, a, "|") == 2) orig[a[1] "|" a[2]] = 1; next }
FILENAME ~ /destino\.txt$/ {
  if (split($0, a, "|") != 5) next
  t = a[1]; c = a[2]; nulo = a[3]; def = a[4]; fk = a[5]
  n = ++ncol[t]
  col[t, n] = c; anulavel[t, c] = nulo; temdef[t, c] = def; alvo[t, c] = fk
  if (c == "organization_id") tem_org[t] = 1
  if (c == "owner_org_id") tem_owner[t] = 1
  next
}
END {
  nt = split(ordem, ts, " ")
  for (i = 1; i <= nt; i++) viaja[ts[i]] = 1
  viaja["organizations"] = 1   # tratada a parte: troca pelo UUID do RH
  viaja["employees"] = 1       # tratada a parte: casa por CPF
  carga = trab "/corpo.sql"
  plano = trab "/plano.txt"
  printf "" > carga
  printf "" > plano
  for (i = 1; i <= nt; i++) {
    t = ts[i]
    if (!(t in ncol))      { print "PULADA " t " : nao existe no RH"            >> plano; continue }
    if (!((t "|id") in orig)) { print "PULADA " t " : nao existe no Vision"     >> plano; continue }

    # como recortar a empresa nesta tabela
    if (tem_org[t])        filtro = "organization_id = " literal(org_vi)
    else if (tem_owner[t]) filtro = "owner_org_id = " literal(org_vi) " and borrower_org_id = " literal(org_vi)
    else                   { print "PULADA " t " : nao sei como recortar a empresa (sem organization_id)" >> plano; continue }

    lista = ""; exprs = ""; anuladas = ""; pula = ""; so_casados = ""
    for (k = 1; k <= ncol[t]; k++) {
      c = col[t, k]
      if (!((t "|" c) in orig)) {            # coluna só do RH
        if (anulavel[t, c] == "NO" && temdef[t, c] == "sem_default")
          pula = pula " " c "(NOT NULL sem default e inexistente no Vision)"
        continue
      }
      e = c
      # `hr_employee_id` nao tem chave estrangeira, entao a regra geral o
      # deixaria passar com o id do VISION — um ponteiro pra lugar nenhum.
      # Entra nulo e o destino preenche casando por CPF.
      if (c == "hr_employee_id") { e = "null::uuid"; anuladas = anuladas " hr_employee_id(preenchido por CPF no destino)" }
      else if (alvo[t, c] == "organizations") e = literal(org_rh) "::uuid"
      else if (alvo[t, c] == "employees") {
        e = "case " c
        achou = 0; emlista = ""
        for (cpf in vi_cpf) if (cpf in rh_cpf) {
          e = e " when " literal(vi_cpf[cpf]) "::uuid then " literal(rh_cpf[cpf]) "::uuid"
          emlista = emlista (emlista == "" ? "" : ", ") literal(vi_cpf[cpf]) "::uuid"
          achou = 1
        }
        e = e " else null end"
        if (!achou) { pula = pula " " c "(aponta pra ficha de RH e nenhum CPF casou)"; continue }
        # só as linhas cujo funcionário casou
        so_casados = so_casados " and (" c " is null or " c " in (" emlista "))"
      }
      else if (alvo[t, c] != "" && !(alvo[t, c] in viaja)) {
        # aponta pra tabela que NAO viaja: o id e do Vision e nao existe no RH.
        # A versao anterior listava so `stores` e `users` como excecao e deixava
        # passar o resto — inclusive `schedule_slots.professional_id ->
        # professionals`, que mataria a transacao inteira no FK. A regra certa
        # nao e uma lista de excecoes.
        if (anulavel[t, c] == "NO") { pula = pula " " c "(NOT NULL e aponta pra " alvo[t, c] ", que nao viaja)"; continue }
        e = "null::uuid"; anuladas = anuladas " " c "->" alvo[t, c]
      }
      lista = lista (lista == "" ? "" : ", ") c
      exprs = exprs (exprs == "" ? "" : ", ") e " as " c
    }
    if (pula != "") { print "PULADA " t " :" pula >> plano; continue }
    if (lista == "") { print "PULADA " t " : nenhuma coluna em comum" >> plano; continue }

    sel = trab "/sel_" t ".sql"
    printf "copy (select %s from public.%s where %s%s) to stdout;\n", exprs, t, filtro, so_casados > sel
    close(sel)
    # o filtro vai pra um arquivo à parte: e assim se consegue MEDIR, antes de
    # escrever, quantas linhas o filtro deixa de fora. Sem isso o usuario
    # descobre no fim, na coluna FALTOU, e ja escreveu.
    printf "%s|%s%s\n", t, filtro, so_casados >> (trab "/filtros.txt")

    printf "\\echo >>> %s\n", t                                                            >> carga
    printf "create temp table _st_%s as select %s from public.%s limit 0;\n", t, lista, t   >> carga
    printf "\\copy _st_%s (%s) from program '"'"'@@PSQL@@ -f /tmp/sel_%s.sql'"'"'\n", t, lista, t >> carga
    printf "insert into public.%s (%s) select %s from _st_%s on conflict do nothing;\n", t, lista, lista, t >> carga
    printf "drop table _st_%s;\n", t                                                       >> carga
    print "COPIA " t " : " ncol[t] " colunas no RH, " split(lista, _tmp, ",") " em comum" (anuladas == "" ? "" : "  | anuladas:" anuladas) >> plano
  }
  close(carga); close(plano)
}
' "$TRAB/mapa-vi.txt" "$TRAB/mapa-rh.txt" "$TRAB/origem.txt" "$TRAB/destino.txt"

sed 's/^/  /' "$TRAB/plano.txt"

# --- tabela pulada que TEM dado no Vision é perda silenciosa ----------------
# "PULADA" no plano é fácil de ler como "não tinha nada". Então aqui se conta:
# se a tabela pulada tem linha no Vision, aquilo NÃO vai, e isso tem que
# aparecer como aviso, não como uma linha no meio de trinta.
while read -r linha; do
  case "$linha" in PULADA*) ;; *) continue ;; esac
  t=$(echo "$linha" | awk '{print $2}')
  tem=$(um_valor "$VISION" "select count(*) from information_schema.columns where table_schema='public' and table_name='$t' and column_name='organization_id'")
  [[ "$tem" == "1" ]] || continue
  n=$(um_valor "$VISION" "select count(*) from $t where organization_id = '$ORG_VI'")
  [[ "${n:-0}" == "0" ]] || aviso "a tabela PULADA \`$t\` tem $n linha(s) no Vision — essas NÃO vão. Motivo: ${linha#* : }"
done < "$TRAB/plano.txt"

CPFS_LISTA=$(um_valor "$VISION" "select string_agg(distinct quote_literal(regexp_replace(cpf,'\\D','','g')), ',') from ponto_employee where organization_id = '$ORG_VI'")
[[ -n "$CPFS_LISTA" ]] || morre "não consegui ler os CPFs do ponto no Vision"
IDS_PE_VISION=$(um_valor "$VISION" "select string_agg(quote_literal(id), ',') from ponto_employee where organization_id = '$ORG_VI'")
[[ -n "$IDS_PE_VISION" ]] || morre "não consegui ler os ids do ponto no Vision"

# --- antes da carga: tirar do RH o cadastro de ponto que vai ser substituído -
# Com batida, PARA. Apagar cadastro que já tem jornada registrada seria
# destruir registro de ponto, e nenhuma pressa justifica isso.
cat > "$TRAB/pre.sql" <<SQL
\\set ON_ERROR_STOP on
begin;

create temp table _pe_sai as
  select pe.id, pe.name from ponto_employee pe
   where pe.organization_id = '$ORG_RH'
     and regexp_replace(coalesce(pe.cpf,''),'\\D','','g') in ($CPFS_LISTA)
     -- e NUNCA o que já veio do Vision: numa segunda execução esses são
     -- justamente os que têm as batidas, e a guarda abaixo travaria o script.
     and pe.id not in ($IDS_PE_VISION);

do \$\$
declare n int; quem text;
begin
  select count(*), coalesce(string_agg(distinct pe.name, ', '), '')
    into n, quem
    from ponto_punch p join ponto_employee pe on pe.id = p.employee_id
   where p.employee_id in (select id from _pe_sai);
  if n > 0 then
    raise exception 'o cadastro de ponto do RH que seria substituido JA TEM % batida(s) (%). Pare: apagar isso destruiria registro de jornada.', n, quem;
  end if;
end \$\$;

delete from ponto_employee where id in (select id from _pe_sai);
SQL

# --- depois da carga: o vínculo com a ficha de RH, e o NSR do empregador ----
cat > "$TRAB/pos.sql" <<SQL
\\echo >>> vinculo com a ficha de RH (por CPF)
update ponto_employee pe
   set hr_employee_id = e.id
  from employees e
 where pe.organization_id = '$ORG_RH'
   and e.organization_id = '$ORG_RH'
   and pe.hr_employee_id is null
   and regexp_replace(coalesce(pe.cpf,''),'\\D','','g') = regexp_replace(coalesce(e.cpf,''),'\\D','','g')
   and regexp_replace(coalesce(pe.cpf,''),'\\D','','g') <> '';

\\echo >>> o NSR do empregador continua de onde parou
update ponto_employer emp
   set last_nsr = greatest(emp.last_nsr, coalesce((select max(p.nsr) from ponto_punch p where p.employer_id = emp.id), 0))
 where emp.id = '$EMPREGADOR_VI';

commit;
SQL

# --- quantas linhas o filtro de funcionário deixa de fora? ------------------
# `work_shifts` e `ponto_shift_swap` apontam pra ficha de RH (employees), e só
# viajam as linhas cujo funcionário casou por CPF. Quando falta ficha no
# destino, isso NÃO é zero — e descobrir no fim, pela coluna FALTOU, é tarde.
if [[ -f "$TRAB/filtros.txt" ]]; then
  PERDE=0
  while IFS='|' read -r t filtro; do
    case "$filtro" in *" in ("*) ;; *) continue ;; esac   # só as com filtro de funcionário
    todas=$(um_valor "$VISION" "select count(*) from $t where organization_id = '$ORG_VI'")
    vao=$(um_valor "$VISION" "select count(*) from $t where $filtro")
    [[ "${todas:-0}" == "${vao:-0}" ]] && continue
    ESPERADO[$t]=$vao
    PERDE=1
    aviso "\`$t\`: $vao de $todas linha(s) vão — as outras $(( ${todas:-0} - ${vao:-0} )) são de funcionário SEM ficha no RH"
  done < "$TRAB/filtros.txt"
  if [[ "$PERDE" == "1" ]]; then
    aviso "para levar essas também: cadastre a ficha (employees) desses CPFs no RH e rode de novo."
    aviso "o script é idempotente — a segunda passada só acrescenta o que faltou."
  fi
fi

if [[ $ENSAIO -eq 1 ]]; then
  log "--ensaio: nada foi escrito. O plano está acima."
  echo "  (sem --ensaio, o script faz dump do $RH e aplica tudo numa transação só)"
  exit 0
fi

# --- dump do destino ANTES de escrever --------------------------------------
if [[ "${SEM_BACKUP:-0}" != "1" ]]; then
  log "dump do $RH antes de mexer"
  if [[ "$MODO" == "producao" ]]; then
    CARIMBO=$(date +%Y%m%d-%H%M%S)
    pct exec "$CT" -- bash -c "cd $INFRA && set -a && . ./.env && set +a && \
      docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" $CONTAINER \
      pg_dump -U postgres -d $RH -Fc -f /tmp/rh-pre-transferencia.dump"
    pct exec "$CT" -- bash -c "mkdir -p /root/dumps && mv /tmp/rh-pre-transferencia.dump /root/dumps/$RH-$CARIMBO.dump"
    ok "dentro do CT $CT: /root/dumps/$RH-$CARIMBO.dump"
  else
    # $TRAB é do root; o pg_dump roda como postgres e não escreveria lá.
    DUMP_LOCAL="/tmp/$RH-$(date +%Y%m%d-%H%M%S).dump"
    su postgres -c "pg_dump -d $RH -Fc -f $DUMP_LOCAL" && ok "$DUMP_LOCAL"
  fi
else
  aviso "SEM_BACKUP=1 — seguindo sem dump"
fi

# --- a carga, numa transação só ---------------------------------------------
PSQL_INTERNO="psql -X -q -U postgres -d $VISION"
SEL_DIR=$([[ "$MODO" == "producao" ]] && echo "/tmp" || echo "$TRAB")
sed -e "s|@@PSQL@@|$PSQL_INTERNO|g" -e "s|/tmp/sel_|$SEL_DIR/sel_|g" "$TRAB/corpo.sql" > "$TRAB/corpo.pronto.sql"
cat "$TRAB/pre.sql" "$TRAB/corpo.pronto.sql" "$TRAB/pos.sql" > "$TRAB/carga.sql"

if [[ "$MODO" == "producao" ]]; then
  for f in "$TRAB"/sel_*.sql; do
    pct push "$CT" "$f" "/tmp/$(basename "$f")"
    pct exec "$CT" -- bash -c "docker cp /tmp/$(basename "$f") $CONTAINER:/tmp/$(basename "$f")"
  done
fi

log "aplicando (uma transação; se falhar, nada entra)"
roda_sql "$RH" "$TRAB/carga.sql" || morre "a carga falhou. A transação foi desfeita — o $RH está como estava."
ok "carga aplicada"

if [[ "$MODO" == "producao" ]]; then
  pct exec "$CT" -- bash -c "rm -f /tmp/sel_*.sql /tmp/carga.sql /tmp/pre.sql; docker exec $CONTAINER rm -f /tmp/sel_*.sql /tmp/carga.sql" 2>/dev/null || true
fi

# --- a conferência que decide se a transferência valeu ----------------------
# Refaz a cadeia de hash no RH do MESMO jeito que o `verifyChain` da API:
# por empregador, na ordem do NSR, esperado =
#   sha256( prev | nsr | employee_id | punched_at ISO | source )
# Se as batidas chegaram íntegras, isto fecha. Se não fecha, a transferência
# não serve, e é melhor saber agora que no dia da fiscalização.
log "reconferindo a cadeia de hash no RH"
CADEIA_RH=$(confere_cadeia "$RH" "$EMPREGADOR_VI")
IFS='|' read -r CR_N CR_H CR_E CR_P <<< "$CADEIA_RH"
printf '  Vision: %s batidas, %s hash fora, %s elo fora (NSR %s)\n' "${CV_N:-?}" "${CV_H:-?}" "${CV_E:-?}" "${CV_P:-?}"
printf '  RH:     %s batidas, %s hash fora, %s elo fora (NSR %s)\n' "${CR_N:-?}" "${CR_H:-?}" "${CR_E:-?}" "${CR_P:-?}"
RUINS=${CR_H:-1}
[[ "${CR_E:-1}" == "0" ]] || RUINS=$((RUINS + CR_E))
if [[ "$CADEIA_RH" == "$CADEIA_VI" ]]; then
  ok "o RH ficou IDÊNTICO ao Vision: mesma contagem, mesmo estado de cadeia"
else
  aviso "o estado da cadeia no RH não é igual ao do Vision — compare as duas linhas acima"
fi

# --- contagens lado a lado --------------------------------------------------
log "o que saiu e o que chegou"
printf '  %-28s %8s %8s %8s\n' "tabela" "Vision" "RH antes" "RH depois"
FALTOU=0
for t in "${CONFERIR[@]}"; do
  existe_vi=$(um_valor "$VISION" "select count(*) from information_schema.columns where table_schema='public' and table_name='$t' and column_name='organization_id'")
  existe_rh=$(um_valor "$RH"     "select count(*) from information_schema.columns where table_schema='public' and table_name='$t' and column_name='organization_id'")
  if [[ "$existe_vi" != "1" || "$existe_rh" != "1" ]]; then
    printf '  %-28s %8s %8s %8s\n' "$t" "-" "-" "(não existe)"; continue
  fi
  a=$(um_valor "$VISION" "select count(*) from $t where organization_id = '$ORG_VI'")
  d=$(um_valor "$RH"     "select count(*) from $t where organization_id = '$ORG_RH'")
  # o alvo não é sempre "o que saiu": onde o filtro de funcionário corta, o
  # alvo é o que sobra depois dele — e isso foi anunciado antes de escrever.
  # Chamar de FALTOU um corte que o próprio script avisou é falso alarme.
  alvo=${ESPERADO[$t]:-$a}
  marca=""
  if [[ "${d:-0}" -lt "${alvo:-0}" ]]; then marca="  <-- FALTOU"; FALTOU=1
  elif [[ -n "${ESPERADO[$t]:-}" ]]; then marca="  (filtrado: $(( ${a:-0} - ${alvo:-0} )) sem ficha no RH)"
  elif [[ "${d:-0}" -gt "${a:-0}" ]]; then marca="  (o RH já tinha ${ANTES[$t]:-0})"; fi
  printf '  %-28s %8s %8s %8s%s\n' "$t" "${a:-?}" "${ANTES[$t]:-0}" "${d:-?}" "$marca"
done
DIVERGIU=$FALTOU

echo
if [[ "${RUINS:-1}" == "0" && "$DIVERGIU" == "0" ]]; then
  printf '%s[PRONTO]%s a cadeia de hash fecha no RH e nada ficou pra tras.\n' "$C_OK" "$C_0"
else
  [[ "${RUINS:-1}" == "0" ]] || aviso "a cadeia NÃO fecha ($RUINS batida(s) fora) — veja a tabela acima"
  [[ "$FALTOU" == "0" ]]     || aviso "alguma tabela chegou com MENOS linhas do que saiu — veja as marcadas FALTOU"
  aviso "o dump de antes está guardado; não aponte o terminal pro RH até isto fechar"
fi

cat <<TXT

FALTA O QUE NÃO É BANCO:

  1. o terminal de ponto ainda bate no Vision. Enquanto ele não for apontado
     pro RH, batida nova entra no Vision e NÃO vem pra cá — e uma segunda
     passada deste script traria só as novas (ele é idempotente), mas a
     cadeia do Vision continuaria sendo a de lá.
  2. o dispositivo veio com o id original, mas pareamento/túnel do terminal é
     configuração do RH: confira em Dispositivos antes de confiar.
  3. confira na tela do RH: Espelho de uma funcionária no mês transferido. O
     espelho é CALCULADO das batidas + escala, então se as duas chegaram ele
     sai igual ao do Vision. É a melhor conferência que existe.

TXT
