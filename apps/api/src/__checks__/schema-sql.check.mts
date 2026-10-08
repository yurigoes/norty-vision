// ============================================================================
// Conferência de DERIVA entre o schema.prisma e as migrations.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/schema-sql.check.mts
//
// O QUE ACONTECEU, em produção
//
// O código do ponto lia e gravava `holiday_policy` e `holiday_pay` — a API em
// `upsertSchedule`, o cálculo do espelho e a tela de Escalas. Nenhuma migration
// criava as colunas: no RH elas nascem na 185, abaixo do corte 198 de onde o
// porte do ponto começou, e vieram só no código.
//
// O efeito não foi um feriado calculado errado. Foi pior: `upsertSchedule`
// monta um objeto `any` e o entrega ao Prisma, que REJEITA argumento que não
// conhece — então CRIAR OU EDITAR QUALQUER ESCALA falhava, sempre. E o
// `(schedule as any)?.holidayPolicy` do cálculo fazia o tsc passar batido.
//
// Três portões não pegaram: tsc (o `any` apagou o tipo), nest build (não olha
// banco) e as conferências existentes (`sql.check.mts` compara SQL escrito à
// mão com o schema.prisma — o caminho inverso deste).
//
// COMO ESTA CONFERÊNCIA LÊ
//
// Por texto, sem banco: toda coluna declarada no `schema.prisma` tem que ser
// criada por ALGUMA migration, em CREATE TABLE ou ALTER TABLE ADD COLUMN.
// Campo de relação não tem coluna e é ignorado; coluna renomeada é seguida pelo
// RENAME COLUMN.
//
// A direção é esta de propósito: Prisma dizendo que existe algo que o banco não
// tem é o erro que derruba em produção. O contrário (coluna no banco que o
// Prisma ignora) é inofensivo e comum — tabela compartilhada com o Norty RH.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = join(api, "..", "..");
const schema = readFileSync(join(api, "prisma", "schema.prisma"), "utf8");
const sqlDir = join(repo, "packages", "db", "sql");

/** Tabelas que o Prisma mapeia mas que NÃO nascem nestas migrations, e por quê. */
const TABELAS_DE_FORA: Record<string, string> = {
  audit_log: "particionada por mês; as partições nascem em código, não em migration",
};

/** Tipos que viram COLUNA. Qualquer outro é relação (ou enum, que também é coluna
 *  — por isso os enums do projeto entram aqui conforme aparecerem). */
const ESCALARES = new Set([
  "String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes",
]);

// --- 1. o que o schema.prisma declara ---------------------------------------
type Campo = { model: string; campo: string; coluna: string };
const porTabela = new Map<string, Campo[]>();
const modelos = schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);
for (const m of modelos) {
  const [, model, corpo] = m;
  const tabela = /@@map\("([^"]+)"\)/.exec(corpo!)?.[1] ?? model!;
  const campos: Campo[] = [];
  for (const linha of corpo!.split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("//") || l.startsWith("@@")) continue;
    const dec = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(l);
    if (!dec) continue;
    const [, campo, tipo, lista] = dec;
    // Campo de RELAÇÃO não tem coluna; o lado que tem é o escalar do
    // @relation(fields: [x]). A primeira versão daqui testava "tipo começa com
    // maiúscula" para achar relação — e TODO tipo escalar do Prisma começa com
    // maiúscula (String, Int, Boolean…), então pulava tudo e a conferência
    // passava com ZERO colunas conferidas. Lista branca é a única forma honesta.
    if (lista || !ESCALARES.has(tipo!)) continue;
    const coluna = /@map\("([^"]+)"\)/.exec(l)?.[1] ?? campo!;
    campos.push({ model: model!, campo: campo!, coluna });
  }
  if (campos.length) porTabela.set(tabela, campos);
}

// --- 2. o que as migrations criam -------------------------------------------
const arquivos = readdirSync(sqlDir).filter((n) => n.endsWith(".sql")).sort();
// COMENTÁRIO FORA, antes de qualquer coisa. O statement é delimitado por `;` e
// `129_ponto_facial.sql` tem um comentário de coluna com ponto e vírgula dentro
// ("RLS protege; mover p/ vault depois") — o ALTER era cortado ali e as quatro
// colunas seguintes sumiam do mapa. Acusar coluna existente é tão ruim quanto
// deixar passar coluna ausente: as duas ensinam a ignorar a conferência.
//
// (Um `--` dentro de string literal seria removido junto. Não acontece aqui, e
// o estrago seria um falso positivo barulhento, não um silêncio.)
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const sql = arquivos.map((n) => semComentario(readFileSync(join(sqlDir, n), "utf8"))).join("\n");
const criadas = new Map<string, Set<string>>();
const add = (t: string, c: string) => {
  const k = t.toLowerCase();
  (criadas.get(k) ?? criadas.set(k, new Set()).get(k)!).add(c.toLowerCase());
};

// CREATE TABLE t ( ... ) — pega o identificador no começo de cada linha do corpo
for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*(?:partition\s+by[^;]*)?;/gi)) {
  const [, tabela, corpo] = m;
  for (const linha of corpo!.split("\n")) {
    const l = linha.trim();
    const col = /^"?(\w+)"?\s+[a-z"]/i.exec(l)?.[1];
    if (!col) continue;
    if (/^(primary|foreign|unique|constraint|check|exclude|like|partition)$/i.test(col)) continue;
    add(tabela!, col);
  }
}
// ALTER TABLE t ADD [COLUMN] [IF NOT EXISTS] col — um statement pode trazer
// VÁRIAS colunas separadas por vírgula, e é assim que a maior parte do schema
// fiscal nasce. Pegar só a primeira dava 80+ falsos positivos: a conferência
// acusava `products.cfop` como inexistente com ele criado na linha seguinte à
// de `ncm`. Casa o statement inteiro, depois varre os ADD COLUMN dentro dele.
for (const st of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi)) {
  const tabela = st[1]!;
  for (const c of st[2]!.matchAll(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) {
    if (/^(constraint|primary|foreign|unique|check|exclude)$/i.test(c[1]!)) continue;
    add(tabela, c[1]!);
  }
}
// RENAME COLUMN a TO b — o nome novo passa a existir
for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/gi)) {
  add(m[1]!, m[3]!);
}

// --- 3. conferência ---------------------------------------------------------
const faltando: string[] = [];
const semTabela: string[] = [];
let conferidas = 0;

for (const [tabela, campos] of porTabela) {
  if (TABELAS_DE_FORA[tabela]) continue;
  const cols = criadas.get(tabela.toLowerCase());
  if (!cols) { semTabela.push(`${campos[0]!.model} → tabela \`${tabela}\` não é criada por nenhuma migration`); continue; }
  for (const c of campos) {
    conferidas++;
    if (!cols.has(c.coluna.toLowerCase())) {
      faltando.push(`${c.model}.${c.campo} → coluna \`${tabela}.${c.coluna}\` não existe em migration nenhuma`);
    }
  }
}

console.log(`colunas do schema.prisma conferidas: ${conferidas} (em ${porTabela.size} tabelas, ${arquivos.length} migrations)`);

// PISO. A primeira versão desta conferência passou verde conferindo ZERO
// colunas, por um filtro errado. Conferência que não confere nada é pior que
// conferência nenhuma: dá a sensação de cobertura. Se o número cair, é a
// leitura que cegou — conserte o parser, não baixe o piso.
if (conferidas < 1500) {
  console.error(`\n✖ só ${conferidas} colunas conferidas — eram 1800+ quando isto foi escrito.`);
  console.error("  A leitura do schema.prisma cegou. Conserte o parser; não baixe o piso.\n");
  process.exit(1);
}

if (semTabela.length || faltando.length) {
  console.error(`\n✖ o schema.prisma promete o que o banco não tem\n`);
  for (const f of semTabela) console.error(`  • ${f}`);
  for (const f of faltando) console.error(`  • ${f}`);
  console.error(
    "\n  Em produção isto NÃO é 'campo volta nulo': o Prisma recusa argumento que\n" +
      "  não conhece, então toda escrita que toque o campo estoura. Escreva a\n" +
      "  migration — e lembre que `deploy-nv-thor.sh` não aplica migration nenhuma,\n" +
      "  quem aplica é `db-apply-nv-thor.sh`, ANTES do código subir.\n",
  );
  process.exit(1);
}

console.log("✔ toda coluna do schema.prisma é criada por alguma migration");
