#!/usr/bin/env bash
# ==============================================================================
# load-cnpj.sh — carrega a base CNPJ (Dados Abertos da Receita) na tabela
# cnpj_company, FILTRADA por UF (default BA) e situação ATIVA. Alimenta o
# Prospector (busca por CNAE + município).
#
# Roda NA VPS (onde está o docker compose). Baixa os arquivos públicos, filtra,
# e faz upsert no Postgres do container yugo-postgres. Idempotente (upsert por CNPJ).
#
# Uso:
#   bash infra/scripts/load-cnpj.sh                # UF=BA, mês mais recente
#   UF=BA CNPJ_MES=2025-05 bash infra/scripts/load-cnpj.sh
#
# Variáveis (opcionais):
#   UF           default BA
#   SITUACAO     default 02 (ATIVA). Vazio = todas.
#   CNPJ_MES     YYYY-MM (default: detecta o mais recente no site da Receita)
#   CNPJ_BASE    URL base (default arquivos.receitafederal.gov.br)
#   WORKDIR      diretório de trabalho (default /tmp/cnpj)
#
# Requisitos na VPS: curl, unzip, iconv, awk, docker (container yugo-postgres up).
# Recomendado: rodar com bastante espaço em disco no WORKDIR (vários GB) e
# preferencialmente fora do horário de pico (consome CPU/IO).
# ==============================================================================
set -euo pipefail

UF="${UF:-BA}"
SITUACAO="${SITUACAO:-02}"
CNPJ_BASE="${CNPJ_BASE:-https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj}"
WORKDIR="${WORKDIR:-/tmp/cnpj}"

C_B=$'\033[34m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
log(){ printf '%s[%s]%s %s\n' "$C_B" "$(date +%H:%M:%S)" "$C_0" "$*"; }
ok(){ printf '%s[OK]%s %s\n' "$C_G" "$C_0" "$*"; }
warn(){ printf '%s[WARN]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die(){ printf '%s[ERR]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

for bin in curl unzip iconv awk docker; do command -v "$bin" >/dev/null || die "Falta o comando: $bin"; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_DIR/infra/docker/.env.production"
[[ -f "$ENV_FILE" ]] || die "Falta $ENV_FILE"
get_env(){ grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
PGDB=$(get_env POSTGRES_DB); PGUSER=$(get_env POSTGRES_USER); PGPW=$(get_env POSTGRES_PASSWORD)
[[ -n "$PGDB" && -n "$PGUSER" && -n "$PGPW" ]] || die "POSTGRES_* ausentes em $ENV_FILE"
docker ps --format '{{.Names}}' | grep -q '^yugo-postgres$' || die "Container yugo-postgres não está rodando"

psql(){ docker exec -i -e PGPASSWORD="$PGPW" yugo-postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 "$@"; }
# \copy lê do STDIN do psql; mandamos o arquivo por pipe
copy_in(){ local tbl="$1" file="$2"; docker exec -i -e PGPASSWORD="$PGPW" yugo-postgres \
  psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -c "\copy $tbl FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\b')" < "$file"; }

# ---- descobre o mês mais recente, se não informado ----
MES="${CNPJ_MES:-}"
if [[ -z "$MES" ]]; then
  log "Detectando mês mais recente em $CNPJ_BASE ..."
  MES=$(curl -fsSL "$CNPJ_BASE/" | grep -oE '[0-9]{4}-[0-9]{2}/' | sort -u | tail -1 | tr -d '/') || true
  [[ -n "$MES" ]] || die "Não consegui detectar o mês. Informe CNPJ_MES=YYYY-MM."
fi
SRC="$CNPJ_BASE/$MES"
log "Fonte: $SRC  ·  UF=$UF  ·  situação=${SITUACAO:-todas}"

mkdir -p "$WORKDIR"; cd "$WORKDIR"
ESTAB_TSV="$WORKDIR/estab_${UF}.tsv"; EMP_TSV="$WORKDIR/emp_${UF}.tsv"; MUN_TSV="$WORKDIR/mun.tsv"
: > "$ESTAB_TSV"

# ---------------------------------------------------------------------------
# 1) ESTABELECIMENTOS (10 arquivos): filtra UF + situação; gera TSV normalizado
#    Layout (1-based após remover aspas): 1 basico,2 ordem,3 dv,5 fantasia,
#    6 situacao,12 cnae,15 logradouro,16 numero,18 bairro,19 cep,20 uf,
#    21 municipio(cod),22 ddd1,23 tel1,28 email
# ---------------------------------------------------------------------------
for i in 0 1 2 3 4 5 6 7 8 9; do
  f="Estabelecimentos${i}.zip"
  log "Baixando $f ..."
  curl -fsSL -o "$f" "$SRC/$f" || { warn "falhou $f (pode não existir neste mês) — pulando"; continue; }
  log "Filtrando $f (UF=$UF) ..."
  unzip -p "$f" \
    | iconv -f LATIN1 -t UTF-8//TRANSLIT 2>/dev/null \
    | sed 's/"//g' \
    | awk -F';' -v uf="$UF" -v sit="$SITUACAO" 'BEGIN{OFS="\t"} (uf=="" || $20==uf) && (sit=="" || $6==sit){ gsub(/\t/," "); print $1$2$3,$1,$12,$20,$21,$22,$23,$28,$5,$15,$16,$18,$19 }' \
    >> "$ESTAB_TSV"
  rm -f "$f"
done
[[ -s "$ESTAB_TSV" ]] || die "Nenhum estabelecimento de $UF encontrado (confira UF/mês)."
awk -F'\t' '{print $2}' "$ESTAB_TSV" | sort -u > "$WORKDIR/basicos.txt"
ok "Estabelecimentos $UF: $(wc -l < "$ESTAB_TSV") · CNPJ-básicos distintos: $(wc -l < "$WORKDIR/basicos.txt")"

# ---------------------------------------------------------------------------
# 2) EMPRESAS (10 arquivos): só os básicos que apareceram em $UF → básico+razão
# ---------------------------------------------------------------------------
: > "$EMP_TSV"
for i in 0 1 2 3 4 5 6 7 8 9; do
  f="Empresas${i}.zip"
  log "Baixando $f ..."
  curl -fsSL -o "$f" "$SRC/$f" || { warn "falhou $f — pulando"; continue; }
  unzip -p "$f" \
    | iconv -f LATIN1 -t UTF-8//TRANSLIT 2>/dev/null \
    | sed 's/"//g' \
    | awk -F';' 'BEGIN{OFS="\t"} FNR==NR{keep[$1]=1; next} ($1 in keep){ gsub(/\t/," "); print $1,$2 }' "$WORKDIR/basicos.txt" - \
    >> "$EMP_TSV"
  rm -f "$f"
done
ok "Empresas (razão social) casadas: $(wc -l < "$EMP_TSV")"

# ---------------------------------------------------------------------------
# 3) MUNICÍPIOS: código → nome
# ---------------------------------------------------------------------------
log "Baixando Municipios.zip ..."
curl -fsSL -o Municipios.zip "$SRC/Municipios.zip" || warn "Municipios.zip falhou (município ficará vazio)"
: > "$MUN_TSV"
[[ -f Municipios.zip ]] && unzip -p Municipios.zip | iconv -f LATIN1 -t UTF-8//TRANSLIT 2>/dev/null | sed 's/"//g' | awk -F';' 'BEGIN{OFS="\t"}{gsub(/\t/," "); print $1,$2}' > "$MUN_TSV"
rm -f Municipios.zip

# ---------------------------------------------------------------------------
# 4) Staging + UPSERT em cnpj_company
# ---------------------------------------------------------------------------
log "Carregando no Postgres (staging)..."
psql <<'SQL'
DROP TABLE IF EXISTS stg_estab, stg_emp, stg_mun;
CREATE UNLOGGED TABLE stg_estab (cnpj text, basico text, cnae text, uf text, mun_code text, ddd1 text, tel1 text, email text, fantasia text, logradouro text, numero text, bairro text, cep text);
CREATE UNLOGGED TABLE stg_emp (basico text, razao text);
CREATE UNLOGGED TABLE stg_mun (code text, name text);
SQL
copy_in stg_estab "$ESTAB_TSV"
copy_in stg_emp   "$EMP_TSV"
[[ -s "$MUN_TSV" ]] && copy_in stg_mun "$MUN_TSV"

log "Upsert em cnpj_company..."
psql <<'SQL'
CREATE INDEX IF NOT EXISTS ix_stg_emp_basico ON stg_emp (basico);
CREATE INDEX IF NOT EXISTS ix_stg_mun_code ON stg_mun (code);
INSERT INTO cnpj_company (cnpj, razao_social, nome_fantasia, cnae_principal, uf, municipio, bairro, logradouro, numero, cep, telefone, email, situacao, updated_at)
SELECT e.cnpj,
       nullif(emp.razao,''),
       nullif(e.fantasia,''),
       nullif(e.cnae,''),
       e.uf,
       lower(translate(coalesce(m.name,''),
         'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC')),
       nullif(e.bairro,''), nullif(e.logradouro,''), nullif(e.numero,''), nullif(e.cep,''),
       nullif(e.ddd1||e.tel1,''),
       nullif(e.email,''),
       'ATIVA', now()
FROM stg_estab e
LEFT JOIN stg_emp emp ON emp.basico = e.basico
LEFT JOIN stg_mun m   ON m.code = e.mun_code
ON CONFLICT (cnpj) DO UPDATE SET
  razao_social=EXCLUDED.razao_social, nome_fantasia=EXCLUDED.nome_fantasia,
  cnae_principal=EXCLUDED.cnae_principal, uf=EXCLUDED.uf, municipio=EXCLUDED.municipio,
  bairro=EXCLUDED.bairro, logradouro=EXCLUDED.logradouro, numero=EXCLUDED.numero, cep=EXCLUDED.cep,
  telefone=EXCLUDED.telefone, email=EXCLUDED.email, situacao=EXCLUDED.situacao, updated_at=now();
DROP TABLE IF EXISTS stg_estab, stg_emp, stg_mun;
SQL

TOTAL=$(psql -tAc "SELECT count(*) FROM cnpj_company WHERE uf='$UF';")
ok "Base CNPJ ($UF) carregada. Total na tabela p/ $UF: $TOTAL"
rm -f "$ESTAB_TSV" "$EMP_TSV" "$MUN_TSV" "$WORKDIR/basicos.txt"
log "Pronto. As campanhas com fonte 'Base CNPJ' já podem buscar por CNAE + município."
