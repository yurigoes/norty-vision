// ============================================================================
// Conferência das consultas escritas à mão (`shell.sql.ts`, `guard.sql.ts`).
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/sql.check.mts
//
// A consulta é SQL escrito à mão: ela não passa pelo Prisma, então nada avisa
// quando alguém renomeia uma coluna no schema ou muda a ordem dos CTEs. Estas
// três conferências cobrem exatamente o que dói:
//
//   1. Nome de coluna e apelido batem com o `schema.prisma` (senão a casca
//      volta com campo faltando, ou a consulta quebra em produção).
//   2. Toda tabela com RLS é lida pendurada em `ctx` — é o que garante que os
//      GUCs foram setados ANTES da leitura. Um `FROM tabela` solto voltaria
//      vazio.
//   3. A elevação pra platform admin acontece uma vez só, no CTE `adm`, e
//      depois dela só se lê o que já era lido elevado antes.
//
// Tudo por leitura de TEXTO, de propósito: assim roda sem banco, sem Prisma
// Client gerado e sem compilar o Nest.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "..");
const sql = readFileSync(join(api, "src", "bootstrap", "shell.sql.ts"), "utf8");
const guard = readFileSync(join(api, "src", "auth", "guard.sql.ts"), "utf8");
const schema = readFileSync(join(api, "prisma", "schema.prisma"), "utf8");

const erros: string[] = [];

// ---------------------------------------------------------------------------
// 1. colunas × schema.prisma
// ---------------------------------------------------------------------------

/** { campoDoPrisma: colunaDoBanco } de um model. */
function modelo(nome: string): Record<string, string> {
  const m = schema.match(new RegExp(`^model ${nome} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`model ${nome} não encontrado em schema.prisma`);
  const cols: Record<string, string> = {};
  for (const linha of m[1].split("\n")) {
    const t = linha.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const [campo, tipo] = t.split(/\s+/);
    if (!campo || !tipo) continue;
    const base = tipo.replace(/[?[\]]/g, "");
    // só escalares: relação (`Membership[]`, `Organization`) tem tipo de model,
    // então não passa aqui. `String[]` (ex.: tech_specs_categories) passa.
    if (!["String", "Int", "Boolean", "DateTime", "Json", "Float", "Decimal", "BigInt"].includes(base)) continue;
    const map = t.match(/@map\("([^"]+)"\)/);
    cols[campo] = map ? map[1] : campo;
  }
  return cols;
}

/**
 * Pares (coluna, apelido) do SQL. Pega tanto `col AS "apelido"` quanto
 * `${iso("col")} AS "apelido"` e `'apelido', p.col` do jsonb_build_object.
 */
function paresDoSql(trecho: string): Array<[string, string]> {
  const pares: Array<[string, string]> = [];
  const alias = /(?:\$\{iso\("([\w.]+)"\)\}|([\w.]+))\s+AS\s+"(\w+)"/g;
  for (const m of trecho.matchAll(alias)) pares.push([(m[1] ?? m[2]).split(".").pop()!, m[3]]);
  const build = /'(\w+)',\s*(?:\$\{iso\("([\w.]+)"\)\}|([\w.]+))/g;
  for (const m of trecho.matchAll(build)) pares.push([(m[2] ?? m[3]).split(".").pop()!, m[1]]);
  return pares;
}

/** Colunas sem apelido (`s0.slug, s0.name`) — nome do campo = nome da coluna. */
function simplesDoSql(trecho: string): string[] {
  const out: string[] = [];
  for (const linha of trecho.split("\n")) {
    const semAlias = linha.replace(/\$\{[^}]*\}/g, "").replace(/\S+\s+AS\s+"\w+"/g, "");
    for (const m of semAlias.matchAll(/(?:^|[\s(,])(?:\w+\.)?(\w+)\s*(?=,|$)/g)) out.push(m[1]);
  }
  return out;
}

function confereBloco(nomeConst: string, model: string, ignorar: string[] = []) {
  const bloco = sql.match(new RegExp(`const ${nomeConst} = \`([\\s\\S]*?)\`;`));
  if (!bloco) {
    erros.push(`bloco ${nomeConst} não encontrado em shell.sql.ts`);
    return;
  }
  const cols = modelo(model);
  const trecho = bloco[1];
  for (const [coluna, campo] of paresDoSql(trecho)) {
    if (ignorar.includes(campo)) continue;
    const esperada = cols[campo];
    if (!esperada) erros.push(`${nomeConst}: campo "${campo}" não existe no model ${model}`);
    else if (esperada !== coluna) {
      erros.push(`${nomeConst}: "${campo}" lê a coluna \`${coluna}\`, mas no ${model} é \`${esperada}\``);
    }
  }
  // blocos que são `jsonb_build_object` só têm pares explícitos — a varredura
  // de "coluna solta" não se aplica a eles
  const soPares = trecho.includes("jsonb_build_object");
  for (const campo of soPares ? [] : simplesDoSql(trecho)) {
    if (ignorar.includes(campo)) continue;
    if (!(campo in cols)) {
      erros.push(`${nomeConst}: coluna solta "${campo}" não existe no model ${model}`);
    } else if (cols[campo] !== campo) {
      erros.push(`${nomeConst}: "${campo}" precisa de apelido — no banco a coluna é \`${cols[campo]}\``);
    }
  }
}

confereBloco("ORG_COLS", "Organization");
confereBloco("STORE_COLS", "Store", ["organization"]);
confereBloco("SUB_COLS", "Subscription", ["plan"]);
confereBloco("PLAN_JSON", "Plan");

// ---------------------------------------------------------------------------
// 2. toda leitura com RLS pendurada em `ctx`
// ---------------------------------------------------------------------------

const corpo = sql.match(/export const SHELL_SQL = `([\s\S]*?)`;/)?.[1] ?? "";
if (!corpo) erros.push("SHELL_SQL não encontrado");

/** CTEs na ordem em que aparecem, com o corpo de cada um. */
const ctes: Array<{ nome: string; corpo: string }> = [];
{
  const re = /(?:^|,)\s*(\w+) AS MATERIALIZED \(/gm;
  const marcos = [...corpo.matchAll(re)];
  marcos.forEach((m, i) => {
    const ini = m.index! + m[0].length;
    const fim = i + 1 < marcos.length ? marcos[i + 1].index! : corpo.length;
    ctes.push({ nome: m[1], corpo: corpo.slice(ini, fim) });
  });
}

const semRls = new Set(["niches"]); // niches não tem RLS; entra por `org` mesmo assim
for (const cte of ctes) {
  if (cte.nome === "ctx") continue;
  const tabelas = [...cte.corpo.matchAll(/\bFROM\s+(\w+)/g)].map((m) => m[1]);
  const lidas = tabelas.filter((t) => !ctes.some((c) => c.nome === t) && !semRls.has(t));
  if (lidas.length === 0) continue;
  const dependeDeCtx = /FROM ctx, LATERAL/.test(cte.corpo);
  const dependeDeOutroCte = ctes.some((c) => c.nome !== cte.nome && new RegExp(`FROM ${c.nome}\\b`).test(cte.corpo));
  if (!dependeDeCtx && !dependeDeOutroCte) {
    erros.push(
      `CTE "${cte.nome}" lê ${lidas.join(", ")} sem depender de ctx — ` +
        `os GUCs do RLS podem não ter rodado ainda, e a consulta volta vazia`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. a elevação acontece uma vez, no lugar certo
// ---------------------------------------------------------------------------

const elevacoes = [...corpo.matchAll(/set_config\('app\.is_platform_admin',\s*'true'/g)];
if (elevacoes.length !== 1) {
  erros.push(`esperava 1 elevação a platform admin, achei ${elevacoes.length}`);
}
const adm = ctes.find((c) => c.nome === "adm");
if (!adm || !/set_config\('app\.is_platform_admin',\s*'true'/.test(adm.corpo)) {
  erros.push("a elevação precisa ficar no CTE `adm` (é o que garante que ela vem depois das leituras do usuário)");
}

/** Depois de `adm`, só estas tabelas — as mesmas que o código antigo já lia elevado. */
const permitidasDepois = new Set(["plans", "platform_integrations", "organizations"]);
const iAdm = ctes.findIndex((c) => c.nome === "adm");
for (const cte of ctes.slice(iAdm + 1)) {
  for (const m of cte.corpo.matchAll(/\bFROM\s+(\w+)/g)) {
    const t = m[1];
    if (ctes.some((c) => c.nome === t)) continue;
    if (!permitidasDepois.has(t)) {
      erros.push(`CTE "${cte.nome}" lê \`${t}\` depois da elevação — só ${[...permitidasDepois].join(", ")} podem`);
    }
  }
}


/** { tabela: nomeDoModel } — vem dos `@@map` do schema. */
function tabelas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const map = m[2].match(/@@map\("([^"]+)"\)/);
    out[map ? map[1] : m[1]] = m[1];
  }
  return out;
}

/**
 * Confere um SQL onde toda coluna vem qualificada (`apelido.coluna AS "campo"`).
 * O apelido é resolvido pelo `FROM tabela apelido` / `JOIN tabela apelido` do
 * próprio SQL; referência a CTE (apelido que não é tabela) é ignorada.
 */
function confereQualificado(arquivo: string, texto: string) {
  const porTabela = tabelas();
  const apelidos: Record<string, string> = {};
  for (const m of texto.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?!AS\b|ON\b|WHERE\b|LATERAL\b)(\w+)/g)) {
    if (porTabela[m[1]]) apelidos[m[2]] = m[1];
  }

  // aqui o apelido é o formato que o guard usa em memória (`membershipId` pra
  // `memberships.id`), então o que se confere é a COLUNA existir na tabela.
  const vistos = new Set<string>();
  for (const m of texto.matchAll(/\b(\w+)\.(\w+)\b/g)) {
    const [, apelido, coluna] = m;
    const tabela = apelidos[apelido];
    if (!tabela) continue; // CTE, não tabela
    const colunas = new Set(Object.values(modelo(porTabela[tabela])));
    vistos.add(`${tabela}.${coluna}`);
    if (!colunas.has(coluna)) {
      erros.push(`${arquivo}: \`${apelido}.${coluna}\` — ${tabela} não tem a coluna \`${coluna}\``);
    }
  }

  // coluna sem apelido = ambígua pro conferidor e pra quem lê
  const corpoSql = texto.replace(/^import[\s\S]*?;\n/gm, "");
  for (const m of corpoSql.matchAll(/SELECT\s+(\w+)\s*,/g)) {
    if (!["SELECT"].includes(m[1])) {
      erros.push(`${arquivo}: coluna "${m[1]}" sem apelido de tabela — qualifique (\`x.${m[1]}\`)`);
    }
  }

  if (vistos.size === 0) erros.push(`${arquivo}: nenhuma coluna qualificada encontrada`);
}

/**
 * O canário tem que estar nos dois lugares — no WITH e no SELECT final — de
 * CADA consulta do arquivo. Um arquivo com duas consultas e um canário só
 * deixaria metade do caminho mudo.
 */
function confereCanario(arquivo: string, texto: string) {
  const consultas = [...texto.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)].filter(
    (m) => m[2].includes("${CONTEXT_CTE}"),
  );
  if (consultas.length === 0) erros.push(`${arquivo}: nenhuma consulta com CTE de contexto`);
  for (const [, nome, corpoQuery] of consultas) {
    if (!corpoQuery.includes("${PROOF_CTE}")) {
      erros.push(`${arquivo}: ${nome} sem \`PROOF_CTE\` — RLS barrado viraria consulta vazia e silenciosa`);
    }
    if (!corpoQuery.includes("${PROOF_SELECT}")) {
      erros.push(`${arquivo}: ${nome} sem \`PROOF_SELECT\` no SELECT final`);
    }
  }
}

confereCanario("shell.sql.ts", sql);
confereCanario("guard.sql.ts", guard);
confereQualificado("guard.sql.ts", guard);

// as consultas do guard tambem penduram tudo em ctx
for (const m of guard.matchAll(/(\w+) AS MATERIALIZED \(([\s\S]*?)\n  \)/g)) {
  const [, nome, corpoCte] = m;
  const leTabela = /\b(?:FROM|JOIN)\s+(\w+)\s/.test(corpoCte);
  if (!leTabela) continue;
  const pendurado = /FROM ctx, LATERAL/.test(corpoCte) || /FROM \w+, LATERAL/.test(corpoCte);
  if (!pendurado) {
    erros.push(`guard.sql.ts: CTE "${nome}" lê tabela sem depender de ctx`);
  }
}

// o guard nunca eleva no meio: ele já roda inteiro como platform admin
if (/set_config\('app\./.test(guard)) {
  erros.push("guard.sql.ts: não pode chamar set_config por fora do CTE de contexto");
}


/**
 * Comentário citando SQL não é SQL — e `${TIED_TO_CTX}` no fonte é a amarração
 * ao `ctx` depois de montada. Tira um, expande o outro.
 */
function semComentarios(texto: string): string {
  const rls = readFileSync(join(api, "src", "prisma", "rls-context.ts"), "utf8");
  const amarra = rls.match(/export const TIED_TO_CTX = `([^`]+)`/)?.[1] ?? "";
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(?:\/\/|--).*$/gm, "")
    .split("${TIED_TO_CTX}")
    .join(amarra);
}

/**
 * A regra que faltava, e que custou caro descobrir.
 *
 * `FROM x, LATERAL (...)` só garante que `x` roda antes se o corpo do LATERAL
 * (a) referenciar `x` e (b) terminar em `OFFSET 0`. Sem (b) o planejador
 * achata o subselect na junção e pode varrer as tabelas ANTES do `set_config`
 * — a consulta volta vazia, e nem o canário percebe.
 */
function confereLaterais(arquivo: string, textoBruto: string) {
  const texto = semComentarios(textoBruto);
  const re = /FROM (\w+), LATERAL \(/g;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const fonte = m[1];
    // corpo do LATERAL: até o parêntese que fecha
    let i = m.index + m[0].length;
    let nivel = 1;
    while (i < texto.length && nivel > 0) {
      if (texto[i] === "(") nivel++;
      else if (texto[i] === ")") nivel--;
      i++;
    }
    const corpoLateral = texto.slice(m.index + m[0].length, i - 1);
    const trecho = `${arquivo}: LATERAL sobre \`${fonte}\``;

    if (!new RegExp(`\\b${fonte}[.\"]`).test(corpoLateral)) {
      erros.push(`${trecho} não referencia \`${fonte}\` — sem isso não é dependência, é cross join`);
    }
    if (!/OFFSET 0\s*$/.test(corpoLateral.trimEnd())) {
      erros.push(`${trecho} não termina em \`OFFSET 0\` — o planejador pode achatar e varrer antes dos GUCs`);
    }
  }
}

confereLaterais("shell.sql.ts", sql);
confereLaterais("guard.sql.ts", guard);
confereLaterais("rls-context.ts", readFileSync(join(api, "src", "prisma", "rls-context.ts"), "utf8"));

/** Nenhuma tabela pode ser lida fora de um LATERAL travado. */
function confereLeiturasSoltas(arquivo: string, textoBruto: string) {
  const texto = semComentarios(textoBruto);
  const porTabela = tabelas();
  for (const m of texto.matchAll(/\bFROM\s+(\w+)/g)) {
    if (!porTabela[m[1]]) continue;
    const antes = texto.lastIndexOf("LATERAL (", m.index);
    const fecha = antes === -1 ? -1 : texto.indexOf("OFFSET 0", antes);
    if (antes === -1 || fecha === -1 || fecha < m.index === false) {
      // a leitura tem que estar entre um "LATERAL (" e o "OFFSET 0" dele
      if (antes === -1 || fecha === -1 || fecha < m.index) {
        erros.push(`${arquivo}: \`FROM ${m[1]}\` fora de um LATERAL travado`);
      }
    }
  }
}

confereLeiturasSoltas("shell.sql.ts", sql);
confereLeiturasSoltas("guard.sql.ts", guard);

// ---------------------------------------------------------------------------

if (erros.length) {
  console.error("Consulta escrita à mão com problema:\n");
  for (const e of erros) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `Consultas escritas à mão OK — casca (${ctes.length} CTEs) e guard: colunas conferidas ` +
    `contra o schema.prisma, RLS pendurado em ctx, canário no lugar e elevação só no fim.`,
);
